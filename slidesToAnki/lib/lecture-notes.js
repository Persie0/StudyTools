import { escapeHtml, normalizePages } from './anki-utils.js';

export const LECTURE_GROUP_MAX_PAGES = 4;
export const LECTURE_GROUP_BATCH_PAGES = 8;
export const LECTURE_GROUP_OVERLAP_PAGES = 4;

// Eight pages is a per-request visual context limit, never a topic boundary.
// Overlap ensures pages 8/9, 12/13, ... appear together in another request.
export function lectureGroupingWindows(pageCount) {
  const total = Math.max(0, Math.floor(Number(pageCount) || 0));
  const windows = [];
  if (!total) return windows;
  const step = LECTURE_GROUP_BATCH_PAGES - LECTURE_GROUP_OVERLAP_PAGES;
  for (let start = 1; start <= total; start += step) {
    const end = Math.min(total, start + LECTURE_GROUP_BATCH_PAGES - 1);
    windows.push({ start, end });
    if (end === total) break;
  }
  return windows;
}

// Reconcile overlapping AI suggestions into a single document-wide sequence.
// Adjacent pages are joined only if the most centrally positioned windows that
// classify BOTH pages agree. Missing/failed AI responses cannot force a split
// against valid evidence from another window. Every PDF page appears once.
export function reconcileLectureWindowGroups(windows, pageCount) {
  const total = Math.max(0, Math.floor(Number(pageCount) || 0));
  if (!total) return [];
  const votes = new Map();
  const titles = [];
  for (const window of windows || []) {
    const start = Math.max(1, Number(window?.start) || 1);
    const end = Math.min(total, Number(window?.end) || total);
    if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) continue;
    const raw = Array.isArray(window?.payload) ? window.payload
      : Array.isArray(window?.payload?.groups) ? window.payload.groups
      : Array.isArray(window?.payload?.sections) ? window.payload.sections : [];
    const assigned = new Map();
    for (let i = 0; i < raw.length; i++) {
      const item = raw[i];
      const pages = normalizePages(item?.pages, total)
        .filter(page => page >= start && page <= end && !assigned.has(page));
      if (!pages.length) continue;
      const title = String(item?.title || item?.name || '').trim().slice(0, 180);
      for (const page of pages) assigned.set(page, i);
      if (title) titles.push({ title, pages, start, end });
    }
    for (let boundary = start; boundary < end; boundary++) {
      if (!assigned.has(boundary) || !assigned.has(boundary + 1)) continue;
      const record = {
        joined: assigned.get(boundary) === assigned.get(boundary + 1),
        // Prefer assessments where both pages are away from window edges.
        depth: Math.min(boundary - start + 1, end - boundary)
      };
      if (!votes.has(boundary)) votes.set(boundary, []);
      votes.get(boundary).push(record);
    }
  }

  const groups = [];
  let pages = [1];
  const flush = () => {
    const matching = titles.map(item => {
      const overlap = item.pages.filter(page => pages.includes(page)).length;
      const depth = Math.min(pages[0] - item.start + 1, item.end - pages[pages.length - 1] + 1);
      return { ...item, overlap, depth };
    }).filter(item => item.overlap);
    matching.sort((a, b) => b.overlap - a.overlap || b.depth - a.depth || a.start - b.start);
    const fallback = pages.length === 1 ? 'Page ' + pages[0] :
      'Pages ' + pages[0] + '–' + pages[pages.length - 1];
    groups.push({ title: matching[0]?.title || fallback, pages });
  };
  for (let boundary = 1; boundary < total; boundary++) {
    const options = votes.get(boundary) || [];
    const depth = Math.max(0, ...options.map(option => option.depth));
    const strongest = options.filter(option => option.depth === depth);
    const joined = strongest.length > 0 && strongest.every(option => option.joined);
    if (joined && pages.length < LECTURE_GROUP_MAX_PAGES) {
      pages.push(boundary + 1);
    } else {
      flush();
      pages = [boundary + 1];
    }
  }
  flush();
  return groups;
}


// AI-proposed grouping is advisory: every original page appears exactly once.
export function normalizeLectureGroups(payload, start, end, { includeMissing = true, maxPages = LECTURE_GROUP_MAX_PAGES } = {}) {
  const raw = Array.isArray(payload) ? payload :
    Array.isArray(payload?.groups) ? payload.groups :
    Array.isArray(payload?.sections) ? payload.sections : [];
  const assigned = new Set();
  const proposed = [];
  for (const item of raw) {
    const title = String(item?.title || item?.name || '').trim().slice(0, 180);
    const pages = normalizePages(item?.pages, end)
      .filter(page => page >= start && page <= end && !assigned.has(page));
    let run = [];
    const flush = () => {
      if (!run.length) return;
      proposed.push({ title: title || 'Pages ' + run.join(', '), pages: run });
      run = [];
    };
    for (const page of pages) {
      if (run.length && (page !== run[run.length - 1] + 1 || run.length >= maxPages)) flush();
      run.push(page);
      assigned.add(page);
    }
    flush();
  }
  // Normal modes retain every page; legacy mode intentionally skips non-content
  // slides and intermediate reveal frames when the whole-PDF model filters them.
  if (includeMissing) {
    for (let page = start; page <= end; page++) {
      if (!assigned.has(page)) proposed.push({ title: 'Page ' + page, pages: [page] });
    }
  }
  return proposed.sort((a, b) => a.pages[0] - b.pages[0]);
}

// Reject empty or severely incomplete whole-document outlines so one weak AI
// response does not produce dozens of isolated fallback pages without context.
export function isUsableLectureOutline(payload, pageCount) {
  const total = Math.max(1, Math.floor(Number(pageCount) || 1));
  const raw = Array.isArray(payload) ? payload :
    Array.isArray(payload?.groups) ? payload.groups :
    Array.isArray(payload?.sections) ? payload.sections : [];
  if (!raw.length) return false;
  const covered = new Set();
  for (const item of raw) {
    for (const page of normalizePages(item?.pages, total)) covered.add(page);
  }
  return covered.size >= Math.ceil(total * 0.7);
}

// Prefer one document-wide outline, just like the original slides-to-Anki
// workflow. Fixed-size image windows are a fallback, not semantic boundaries.
export function buildWholeDocumentLectureGroupingPrompt({ pageCount, language = 'auto', detailedGrouping = false } = {}) {
  const count = Math.max(1, Math.floor(Number(pageCount) || 1));
  const languageRule = language === 'auto'
    ? 'Write titles in the primary language of the PDF.' : 'Write titles in ' + language + '.';
  return [
    'First analyze the ENTIRE attached lecture PDF as one coherent document, BEFORE deciding where individual Anki cards begin or end.',
    'Identify the logical outline, continuity between neighboring slides, incremental reveals and transitions between topics.',
    'Return groups of consecutive ORIGINAL PDF pages representing focused concepts or closely related explanations.',
    'No fixed-size processing boundaries exist: adjacent pages (including pages 8 and 9, 16 and 17, etc.) may belong together.',
    detailedGrouping
      ? 'Use DETAILED GROUPING: small, focused groups of 1–4 slides, each covering one or two key concepts. Split longer topics at concept transitions.'
      : 'Use ORIGINAL GROUPING: group all consecutive slides that cover one coherent topic. Do not split solely to fit 4 pages.',
    'Each group needs a concise, descriptive title suitable for the front of an Anki card.',
    'Use all substantive slide content, including diagrams, formula-heavy pages, conclusions and summaries.',
    'As in the original converter, REMOVE only genuinely content-free title, agenda, section-divider, acknowledgements and thank-you slides.',
    'For incremental reveal slides of the SAME concept, retain only the final/most complete visual slide in the pages list.',
    'Do not discard substantive summaries, explanations, conclusions or diagram pages. Do not skip useful learning material.',
    'Do not repeat included page numbers, and use ORIGINAL 1-based page numbers from 1 to ' + count + '.',
    languageRule,
    'Return strictly valid JSON only:',
    '{"groups":[{"title":"First concept","pages":[1,2]},{"title":"Next concept","pages":[3,4]}]}',
    'The numbers in the example are placeholders. Analyze the PDF and provide real topic boundaries for the entire document.'
  ].join('\n');
}

export function buildLectureGroupingPrompt({ start, end, language = 'auto' }) {
  const languageRule = language === 'auto'
    ? 'Use the main language of the original slides.' : 'Use ' + language + '.';
  return [
    'Group these lecture slides into cohesive Anki study-note cards.',
    'The attached images represent ORIGINAL PDF pages ' + start + ' through ' + end + ', in that order.',
    'This is an OVERLAPPING WINDOW, not a self-contained chapter. Topic groups may continue into pages outside this window.',
    'Do not invent topic boundaries at the first or last page of this window. Compare adjacent pages and group coherent neighbors.',
    'Create one card per focused concept, usually 1–3 CONTIGUOUS pages, never more than 4 pages.',
    'Use a short descriptive concept/topic title for the front of each card.',
    'INCLUDE EVERY original PDF page exactly once, even administrative pages. Attach section dividers to the next topic when possible.',
    'Combine incremental reveals of the same slide into one group, retaining the most complete view and context.',
    'Never invent page numbers or refer to pages outside the provided range.',
    languageRule,
    'Return strictly valid JSON only, using the ORIGINAL 1-based PDF page numbers:',
    '{"groups":[{"title":"Specific topic name","pages":[' + start + (start < end ? ',' + (start + 1) : '') + ']}]}',
    'Replace the example numbers with actual source page numbers and escape JSON backslashes.'
  ].join('\n');
}

export function buildLectureExplanationPrompt({ pages, language = 'auto' }) {
  const languageRule = language === 'auto'
    ? 'Write in the primary language of the slides.' : 'Write in ' + language + '.';
  return [
    'Write comprehensive but understandable lecture study notes from the attached slide images.',
    'Explain EVERY supplied original PDF page: ' + pages.join(', ') + '. Images appear in ascending page order.',
    'Go significantly beyond merely copying or describing slide text. Explain what concepts MEAN, WHY they work and HOW ideas connect.',
    'Cover all substantive bullet points, diagrams, labels, tables, equations and examples rather than a few highlights.',
    'For graphs and diagrams, interpret axes, units, arrows, components, patterns and relationships.',
    'For equations, explain every symbol, relevant units, assumptions, intuition, use cases and an illustrative worked example where appropriate.',
    'Teach the steps and causal reasoning, define new terms, explain connections across pages and add valuable context without inventing facts.',
    'Identify exam-worthy takeaways, applications and common misconceptions. State uncertainty when information is unreadable.',
    'Explain every page separately with an explicit heading containing its ORIGINAL page number (e.g. Page 24), then discuss how the pages connect.',
    'Write detailed connected paragraphs, not only a short bullet list. Keep the explanation substantial and accurate.',
    'Use JSON-escaped LaTeX/MathJax and escaped newlines for paragraph breaks.',
    languageRule,
    'Original extracted PDF text follows as a supplement to the images; inspect visuals directly.',
    'Return strictly valid JSON only:',
    '{"title":"precise concept title","overview":"short orientation","explanation":"Explain every original page in detailed, separate paragraphs","keyPoints":["important point"],"examples":["short illustrative example"],"pitfalls":["common misconception"]}',
    'Do not omit any substantive material from the supplied pages.'
  ].join('\n');
}

export function normalizeLectureExplanation(value) {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const explanation = String(record.explanation || record.detailedExplanation || '').trim();
  if (!explanation) throw new Error('Gemini returned no detailed lecture explanation.');
  const list = input => (Array.isArray(input) ? input : [])
    .filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean).slice(0, 16);
  return {
    title: String(record.title || '').trim().slice(0, 180),
    overview: String(record.overview || '').trim(),
    explanation,
    keyPoints: list(record.keyPoints || record.key_points),
    examples: list(record.examples),
    pitfalls: list(record.pitfalls)
  };
}

function paragraphs(value) {
  return String(value).trim().split(/\n\s*\n/)
    .map(part => '<p>' + escapeHtml(part).replace(/\n/g, '<br>') + '</p>').join('');
}

export function lectureBackHtml(card, media) {
  const slideImages = card.pages.map(page => {
    const name = media.get(page);
    if (!name) throw new Error('Source image for PDF page ' + page + ' is missing from the Anki package.');
    return '<figure class="lecture-page"><figcaption>PDF page ' + page +
      '</figcaption><img src="' + escapeHtml(name) + '" alt="PDF page ' + page + '"></figure>';
  }).join('');
  const pageText = card.pages.map(page => {
    const original = card.textByPage?.[page] || '';
    return '<div class="lecture-page-text"><h4>Page ' + page +
      '</h4><div class="lecture-verbatim">' +
      (original.trim() ? escapeHtml(original) : '<em>No selectable PDF text on this page; see its image above.</em>') +
      '</div></div>';
  }).join('');
  const explanation = normalizeLectureExplanation(card.explanation);
  const section = (title, values) => values.length
    ? '<section class="lecture-notes-section"><h3>' + title + '</h3><ul>' +
      values.map(v => '<li>' + escapeHtml(v) + '</li>').join('') + '</ul></section>' : '';
  return [
    '<section class="lecture-source-images"><h3>Original slides</h3>' + slideImages + '</section>',
    '<section class="lecture-source-text"><h3>Full extracted PDF text</h3>' + pageText + '</section>',
    '<section class="lecture-explanation"><h3>Detailed explanation</h3>',
    explanation.overview ? '<div class="lecture-overview">' + paragraphs(explanation.overview) + '</div>' : '',
    paragraphs(explanation.explanation),
    '</section>',
    section('Key points to remember', explanation.keyPoints),
    section('Examples and applications', explanation.examples),
    section('Common mistakes', explanation.pitfalls)
  ].join('');
}


// Original (pre-redesign) note layout. The "Text" field is intentionally NOT
// referenced in qfmt or afmt: Anki can search it in the collection browser,
// but studying the card shows just the topic, slides and explanation.
export function legacyLectureSearchText(card) {
  return card.pages.map(page =>
    '\n--- Slide (Page ' + page + ') ---\n' + String(card.textByPage?.[page] || '')
  ).join('').trim();
}

export function legacyLectureImageHtml(card, media, { slideBySlide = false } = {}) {
  return card.pages.map(page => {
    const name = media.get(page);
    if (!name) throw new Error('Source image for PDF page ' + page + ' is missing from the Anki package.');
    const image = '<img src="' + escapeHtml(name) + '" alt="Slide ' + page + '">';
    const annotation = slideBySlide ? String(card.annotationsByPage?.[page] || '').trim() : '';
    return image + (annotation
      ? '<div class="slide-annotation">' + paragraphs(annotation) + '</div>'
      : '');
  }).join('<br>');
}

export function legacyLectureExplanationHtml(explanation) {
  const normalized = normalizeLectureExplanation(explanation);
  // Keep the original teaching-style explanation box. No visible "source text",
  // "page N", key-points heading, or other redesign-only sub-sections.
  const intro = normalized.overview ? paragraphs(normalized.overview) : '';
  return intro + paragraphs(normalized.explanation);
}

export function legacyLectureNoteFields(card, media, {
  order = '',
  includeText = true,
  slideBySlide = false
} = {}) {
  return [
    String(order),
    escapeHtml(card.title),
    legacyLectureImageHtml(card, media, { slideBySlide }),
    slideBySlide ? '' : legacyLectureExplanationHtml(card.explanation),
    includeText ? escapeHtml(legacyLectureSearchText(card)) : ''
  ];
}

export function buildLegacyLectureAnnotationPrompt({ page, language = 'auto' } = {}) {
  const languageRule = language === 'auto'
    ? 'Respond in the language of this slide.' : 'Respond in ' + language + '.';
  return [
    'You are annotating a single slide for an Anki flashcard, matching the original slide-by-slide feature.',
    'Original PDF page ' + page + ' is attached as an image, together with its extracted text.',
    'If the slide is self-explanatory, return an empty annotation.',
    'If it has only keywords, formulas, an unexplained diagram or incomplete context, briefly clarify the essential ideas.',
    'Explain the math with Anki-compatible MathJax when applicable.',
    languageRule,
    'Return JSON only: {"annotation":"brief optional clarification"}'
  ].join('\n');
}
