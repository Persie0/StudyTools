import { escapeHtml, normalizePages } from './anki-utils.js';

export const LECTURE_GROUP_MAX_PAGES = 4;
export const LECTURE_GROUP_BATCH_PAGES = 8;

// AI-proposed grouping is advisory: every original page appears exactly once.
export function normalizeLectureGroups(payload, start, end) {
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
      if (run.length && (page !== run[run.length - 1] + 1 || run.length >= LECTURE_GROUP_MAX_PAGES)) flush();
      run.push(page);
      assigned.add(page);
    }
    flush();
  }
  // Never silently omit content that the AI failed to classify.
  for (let page = start; page <= end; page++) {
    if (!assigned.has(page)) proposed.push({ title: 'Page ' + page, pages: [page] });
  }
  return proposed.sort((a, b) => a.pages[0] - b.pages[0]);
}

export function buildLectureGroupingPrompt({ start, end, language = 'auto' }) {
  const languageRule = language === 'auto'
    ? 'Use the main language of the original slides.' : 'Use ' + language + '.';
  return [
    'Group these lecture slides into cohesive Anki study-note cards.',
    'The attached images represent ORIGINAL PDF pages ' + start + ' through ' + end + ', in that order.',
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
