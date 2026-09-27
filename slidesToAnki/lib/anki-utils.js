function cleanString(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function normalizePages(pages, pageCount = Infinity) {
  const max = Number.isFinite(pageCount) ? Math.max(1, pageCount) : Infinity;
  const result = [...new Set((Array.isArray(pages) ? pages : [])
    .map(value => Number.parseInt(value, 10))
    .filter(value => Number.isInteger(value) && value >= 1 && value <= max))];
  return result.sort((a, b) => a - b);
}

export function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : cleanString(tags).split(/[;,]/);
  return [...new Set(list.map(tag => cleanString(tag).replace(/\s+/g, '_')).filter(Boolean))].slice(0, 12);
}

export function normalizeCard(card, pageCount = Infinity) {
  const front = cleanString(card?.front || card?.question || card?.title);
  const back = cleanString(card?.back || card?.answer || card?.explanation);
  if (!front || !back) return null;
  return {
    front,
    back,
    pages: normalizePages(card?.pages || card?.sourcePages || card?.source_pages, pageCount),
    tags: normalizeTags(card?.tags || card?.topics || [])
  };
}

export function normalizeCards(payload, pageCount = Infinity) {
  const raw = Array.isArray(payload) ? payload : Array.isArray(payload?.cards) ? payload.cards : [];
  const seen = new Set();
  const cards = [];
  for (const item of raw) {
    const card = normalizeCard(item, pageCount);
    if (!card) continue;
    const key = `${card.front.toLowerCase()}\u0000${card.back.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push(card);
  }
  return cards;
}

export function densityInstruction(density = 'balanced', pageCount = 1) {
  const pages = Math.max(1, Number(pageCount) || 1);
  if (density === 'compact') return `Aim for about ${Math.max(4, Math.ceil(pages * 0.6))} high-value cards total.`;
  if (density === 'detailed') return `Aim for about ${Math.max(8, Math.ceil(pages * 2.2))} focused cards total, splitting multi-part facts when useful.`;
  return `Aim for about ${Math.max(6, Math.ceil(pages * 1.2))} high-quality cards total.`;
}

export function buildPdfCardPrompt({ pageCount, density = 'balanced', language = 'auto', mode = 'questions' } = {}) {
  const languageRule = language === 'auto'
    ? 'Write cards in the primary language of the PDF.'
    : `Write cards in ${language}.`;
  const modeRule = mode === 'topics'
    ? 'Prefer topic/concept fronts with concise explanatory backs.'
    : 'Prefer recall questions on the front and self-contained answers on the back.';

  return [
    'Create an Anki deck from the attached PDF.',
    'Use the PDF itself as the source of truth, including diagrams, plots, tables, equations, annotations, and visual relationships. Do not rely only on extracted text.',
    modeRule,
    densityInstruction(density, pageCount),
    languageRule,
    'Prioritize examinable concepts, definitions, mechanisms, formulas, comparisons, causal relationships, exceptions, and diagram interpretation.',
    'Make each front understandable without seeing the source page; never ask vague questions like "What is shown here?".',
    'Keep answers concise but complete. For mathematical notation, use Anki-compatible MathJax delimiters \\(...\\) or \\[...\\].',
    'Avoid trivial cards, duplicates, administrative slides, agenda/title pages, and cards that can only be understood with missing context.',
    'If several incremental slides show the same concept, use the final/most complete slide as the primary source.',
    'Every card must include the 1-based source page numbers that support it.',
    'Return JSON only in this exact shape:',
    '{"cards":[{"front":"...","back":"...","pages":[1],"tags":["topic"]}]}'
  ].join('\n');
}

export function buildTextCardPrompt({ density = 'balanced', language = 'auto' } = {}) {
  const languageRule = language === 'auto' ? 'Use the primary language of the material.' : `Use ${language}.`;
  return [
    'Create high-quality Anki flashcards from the supplied study material.',
    densityInstruction(density, 10),
    languageRule,
    'Prefer recall questions and concise self-contained answers. Avoid duplicates and trivia.',
    'For mathematical notation, use Anki-compatible MathJax delimiters \\(...\\) or \\[...\\].',
    'Return JSON only in this exact shape:',
    '{"cards":[{"front":"...","back":"...","pages":[],"tags":["topic"]}]}'
  ].join('\n');
}

export function safeDeckName(fileName = 'Study Deck') {
  return String(fileName || 'Study Deck')
    .replace(/\.[^.]+$/, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim() || 'Study Deck';
}

export function stableNumericId(seed) {
  let hash = 2166136261;
  const text = String(seed || 'studytools');
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) + 1000000000;
}

export function cardBackHtml(card, sourceMediaNames = []) {
  const answer = `<div class="ai-answer">${escapeHtml(card.back).replace(/\n/g, '<br>')}</div>`;
  const pages = card.pages.length ? `<div class="source-pages">Source pages: ${card.pages.join(', ')}</div>` : '';
  const images = sourceMediaNames.map(name => `<div class="source-slide"><img src="${escapeHtml(name)}" alt="Source page"></div>`).join('');
  return `${answer}${pages}${images}`;
}


export function buildSlideExplanationPrompt({ pageNumber, pageCount, language = 'auto' } = {}) {
  const languageRule = language === 'auto'
    ? 'Write in the primary language used on the slide.'
    : `Write in ${language}.`;
  return [
    'Explain this lecture slide for a student who wants to understand and study the material.',
    'Use the slide image as the source of truth. Explain every meaningful concept, label, formula, diagram, relationship, and example visible on it.',
    'Be simple but detailed: define unfamiliar terms, explain why formulas or processes work, connect the elements, and mention likely misconceptions. Do not merely repeat the slide text.',
    'Stay faithful to the slide. If an element is unreadable or the slide lacks context, say so briefly instead of guessing.',
    languageRule,
    `This is slide ${pageNumber} of ${pageCount}. Refer to other slides only when they are present in the supplied context.`,
    'Return JSON only in this exact shape:',
    '{"title":"short descriptive slide title","explanation":"clear, detailed explanation in paragraphs","keyPoints":["important point","important point"],"terms":[{"term":"term","meaning":"meaning"}]}'
  ].join('\\n');
}

export function normalizeSlideExplanation(value, pageNumber) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const clean = input => String(input ?? '').replace(/\\s+/g, ' ').trim();
  const title = clean(raw.title) || `Slide ${pageNumber}`;
  const explanation = clean(raw.explanation || raw.explanationText || raw.summary);
  if (!explanation) throw new Error(`Gemini returned no explanation for slide ${pageNumber}.`);
  const keyPoints = (Array.isArray(raw.keyPoints) ? raw.keyPoints : Array.isArray(raw.key_points) ? raw.key_points : [])
    .map(clean).filter(Boolean).slice(0, 8);
  const terms = (Array.isArray(raw.terms) ? raw.terms : [])
    .map(item => ({ term: clean(item?.term), meaning: clean(item?.meaning || item?.definition) }))
    .filter(item => item.term && item.meaning).slice(0, 8);
  return { pageNumber, title, explanation, keyPoints, terms };
}

export function normalizeSlideExplanations(payload, pageCount) {
  const raw = Array.isArray(payload) ? payload : Array.isArray(payload?.slides) ? payload.slides : null;
  if (!raw) throw new Error('Gemini returned an invalid slide explanation payload.');
  if (raw.length !== pageCount) throw new Error(`Expected ${pageCount} slide explanations, but received ${raw.length}.`);
  return raw.map((item, index) => normalizeSlideExplanation(item, index + 1));
}
