import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  LECTURE_GROUP_BATCH_PAGES,
  LECTURE_GROUP_OVERLAP_PAGES,
  lectureGroupingWindows,
  buildWholeDocumentLectureGroupingPrompt,
  isUsableLectureOutline,
  reconcileLectureWindowGroups,
  LECTURE_GROUP_MAX_PAGES,
  normalizeLectureGroups,
  buildLectureGroupingPrompt,
  buildLectureExplanationPrompt,
  normalizeLectureExplanation,
  legacyLectureNoteFields,
  legacyLectureSearchText,
  legacyLectureImageHtml,
  legacyLectureExplanationHtml,
  buildLegacyLectureAnnotationPrompt,
  lectureBackHtml
} from '../slidesToAnki/lib/lecture-notes.js';
import { normalizeSettings } from '../slidesToAnki/lib/settings.js';

test('new lecture mode is a persistent independent card style', () => {
  assert.equal(normalizeSettings({ cardMode: 'lecture' }).cardMode, 'lecture');
  assert.equal(normalizeSettings({}).cardMode, 'topics');
  assert.equal(LECTURE_GROUP_MAX_PAGES, 4);
  assert.equal(LECTURE_GROUP_BATCH_PAGES, 8);
  assert.equal(LECTURE_GROUP_OVERLAP_PAGES, 4);
});

test('grouping never drops, duplicates or reorders original source PDF pages', () => {
  const groups = normalizeLectureGroups({ groups: [
    { title: 'AI group', pages: [5, 4, 7] },
    { title: 'Duplicate', pages: [5, 6] },
    { title: 'Out of range', pages: [99, -1] }
  ] }, 4, 8);
  assert.deepEqual(groups.map(group => group.pages), [[4, 5], [6], [7], [8]]);
  const pages = groups.flatMap(group => group.pages);
  assert.deepEqual(pages, [4, 5, 6, 7, 8]);
});

test('grouping automatically splits oversized ranges into at most four-page groups', () => {
  const groups = normalizeLectureGroups([{ title: 'Long topic', pages: [1, 2, 3, 4, 5, 6, 7, 8] }], 1, 8);
  assert.deepEqual(groups.map(group => group.pages), [[1, 2, 3, 4], [5, 6, 7, 8]]);
});

test('malformed or missing AI groups fall back to complete one-page coverage', () => {
  assert.deepEqual(normalizeLectureGroups(null, 20, 22), [
    { title: 'Page 20', pages: [20] },
    { title: 'Page 21', pages: [21] },
    { title: 'Page 22', pages: [22] }
  ]);
});

test('lecture prompts require full coverage, multimodal reasoning and thorough explanation', () => {
  const grouping = buildLectureGroupingPrompt({ start: 24, end: 29, language: 'German' });
  assert.match(grouping, /INCLUDE EVERY original PDF page/);
  assert.match(grouping, /24 through 29/);
  assert.match(grouping, /contiguous/i);
  const explaining = buildLectureExplanationPrompt({ pages: [24, 25], language: 'German' });
  for (const phrase of ['ENTIRE group', 'formulas', 'diagrams', '<p>', 'Anki MathJax', 'German']) {
    assert.ok(explaining.includes(phrase), 'Missing original group explanation guidance: ' + phrase);
  }
});

test('lecture explanation validation requires real content, preserves substantial paragraphs', () => {
  assert.throws(() => normalizeLectureExplanation({ overview: 'Only summary' }), /no detailed lecture explanation/);
  const detail = normalizeLectureExplanation({
    title: 'A',
    overview: 'Intro',
    explanation: 'Full section 1.\n\nFull section 2.',
    keyPoints: ['Point A', ''],
    examples: ['Example B'],
    pitfalls: ['Common mistake']
  });
  assert.equal(detail.explanation, 'Full section 1.\n\nFull section 2.');
  assert.deepEqual(detail.keyPoints, ['Point A']);
});


test('legacy note fields match the pre-redesign five-field structure', () => {
  const card = {
    title: 'Topic <A>',
    pages: [3, 4],
    textByPage: { 3: 'First part\nSecond part <tag> & "quoted"', 4: 'Text from page four' },
    explanation: { explanation: '<p>Reason <b>important</b>.</p><ul><li>Consequence</li></ul>' }
  };
  const media = new Map([[3, 'source3.jpg'], [4, 'source4.jpg']]);
  const fields = legacyLectureNoteFields(card, media, { order: '1230001', includeText: true });
  assert.equal(fields.length, 5);
  const [order, front, back, backContent, searchText] = fields;
  assert.equal(order, '1230001');
  assert.equal(front, 'Topic &lt;A&gt;');
  assert.ok(back.includes('source3.jpg') && back.includes('source4.jpg'));
  assert.ok(back.indexOf('source3.jpg') < back.indexOf('source4.jpg'));
  assert.ok(!back.includes('First part') && !back.includes('Reason'));
  assert.match(backContent, /<p>Reason <b>important<\/b>\.<\/p>/);
  assert.ok(!backContent.includes('First part') && !backContent.includes('Full extracted PDF text'));
  assert.ok(searchText.includes('First part\nSecond part &lt;tag&gt; &amp; &quot;quoted&quot;'));
  assert.ok(searchText.includes('Text from page four'));
  assert.ok(searchText.includes('--- Slide (Page 3) ---'));
});

test('search text can be disabled without affecting visual card answers', () => {
  const card = { title: 'Concept', pages: [1], textByPage: { 1: 'Secret searchable text' },
    explanation: { explanation: 'Explained.' } };
  const media = new Map([[1, 'slide1.jpg']]);
  const included = legacyLectureNoteFields(card, media, { includeText: true });
  const excluded = legacyLectureNoteFields(card, media, { includeText: false });
  assert.deepEqual(included.slice(0, 4), excluded.slice(0, 4));
  assert.equal(excluded[4], '');
  assert.ok(included[4].includes('Secret searchable text'));
});

test('slide-by-slide version annotates images individually and leaves BackContent empty', () => {
  const card = {
    title: 'Mechanism', pages: [1, 2],
    annotationsByPage: { 1: '', 2: 'A useful clarification' },
    textByPage: { 1: 'Text1', 2: 'Text2' }
  };
  const fields = legacyLectureNoteFields(card, new Map([[1, 'slide1.jpg'], [2, 'slide2.jpg']]),
    { slideBySlide: true, includeText: true });
  assert.equal(fields[3], '');
  assert.ok(fields[2].indexOf('slide1.jpg') < fields[2].indexOf('slide2.jpg'));
  assert.ok(fields[2].includes('<div class="slide-annotation">'));
  assert.ok(fields[2].includes('A useful clarification'));
  assert.ok(fields[4].includes('Text1') && fields[4].includes('Text2'));
  assert.match(buildLegacyLectureAnnotationPrompt({ page: 2 }), /self-explanatory/);
});

test('original group HTML formatting is supported without allowing executable content', () => {
  const html = legacyLectureExplanationHtml({
    explanation: '<p>Valid <b>bold</b> and <i>italic</i>.</p><script>alert(1)</script><img src=x onerror=alert(2)>'
  });
  assert.ok(html.includes('<p>Valid <b>bold</b> and <i>italic</i>.</p>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;img'));
  assert.equal(html.includes('<script>'), false);
});

test('original grouping permits intentional skipping and longer sections when detailed grouping is off', () => {
  const proposed = { groups: [
    { title: 'Real topic', pages: [2, 3, 4, 5, 6, 7] },
    { title: 'Second', pages: [9] }
  ] };
  const normalized = normalizeLectureGroups(proposed, 1, 10,
    { includeMissing: false, maxPages: Infinity });
  assert.deepEqual(normalized.map(x => x.pages), [[2, 3, 4, 5, 6, 7], [9]]);
  const detailed = normalizeLectureGroups(proposed, 1, 10,
    { includeMissing: false, maxPages: 4 });
  assert.deepEqual(detailed.map(x => x.pages), [[2, 3, 4, 5], [6, 7], [9]]);
  const prompt = buildWholeDocumentLectureGroupingPrompt({ pageCount: 10, detailedGrouping: true });
  assert.match(prompt, /DETAILED GROUPING/);
  assert.match(prompt, /REMOVE only genuinely content-free/);
});

test('legacy grouping retains a single card when middle reveal slides are deliberately omitted', () => {
  const original = normalizeLectureGroups({ groups: [
    { title: 'Topic with hidden incremental pages', pages: [2, 5, 7] }
  ] }, 1, 8, { includeMissing: false, maxPages: Infinity });
  assert.deepEqual(original, [{ title: 'Topic with hidden incremental pages', pages: [2, 5, 7] }]);
  assert.equal(isUsableLectureOutline({ groups: [{ pages: [2, 5, 7] }] }, 8, 0.3), true);
});

test('app routes PDF legacy mode into original searchable five-field Anki export', async () => {
  const app = await readFile(new URL('../slidesToAnki/app.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../slidesToAnki/gemini-anki.html', import.meta.url), 'utf8');
  assert.match(html, /value="lecture"/);
  assert.match(html, /id="legacy-include-text"/);
  assert.match(html, /id="legacy-slide-by-slide"/);
  assert.match(app, /await generateLectureCards\(client, model, pdf, buffer\)/);
  assert.match(app, /forceAll: lecture/);
  assert.match(app, /legacyLectureNoteFields\(card, media/);
  assert.match(app, /ui\.legacyIncludeText\.checked/);
  assert.match(app, /ui\.legacySlideBySlide\.checked/);
  assert.match(app, /ui\.legacyDetailedGrouping\.checked/);
  assert.match(app, /imageCache\?\.get\(page\)/);
  assert.match(app, /extractLecturePageText\(pdf, page\)/);
  assert.match(app, /control\.disabled = lectureMode/);
  const legacy = app.slice(app.indexOf('function lectureAnkiModel()'), app.indexOf('async function createDeck('));
  for (const field of ['Order', 'Front', 'Back', 'BackContent', 'Text']) {
    assert.ok(legacy.includes("name: '" + field + "'"));
  }
  assert.ok(legacy.includes("qfmt: '{{Front}}'"));
  assert.ok(legacy.includes('{{Back}}<br><div class="back-content">{{BackContent}}</div>'));
  assert.ok(!legacy.includes('{{Text}}'), 'search field must never be visible on the card');
});
test('overlapping windows keep every adjacent pair in at least one visual request', () => {
  for (const count of [1, 4, 8, 9, 12, 13, 17, 51, 100]) {
    const windows = lectureGroupingWindows(count);
    const pages = Array.from({ length: count }, (_, i) => i + 1);
    for (const page of pages) {
      assert.ok(windows.some(w => page >= w.start && page <= w.end), 'Missing page ' + page);
    }
    for (let page = 1; page < count; page++) {
      assert.ok(windows.some(w => w.start <= page && w.end >= page + 1),
        'Artificial topic boundary at pages ' + page + '–' + (page + 1));
    }
    assert.ok(windows.every(w => w.end - w.start + 1 <= LECTURE_GROUP_BATCH_PAGES));
  }
  assert.deepEqual(lectureGroupingWindows(17), [
    { start: 1, end: 8 }, { start: 5, end: 12 },
    { start: 9, end: 16 }, { start: 13, end: 17 }
  ]);
  assert.deepEqual(lectureGroupingWindows(0), []);
});

test('global reconciliation groups pages 7–10 across the previous 8/9 boundary', () => {
  const windows = [
    { start: 1, end: 8, payload: { groups: [
      { title: 'Earlier', pages: [1, 2, 3, 4] },
      { title: 'Bridge topic', pages: [7, 8] }
    ] } },
    { start: 5, end: 12, payload: { groups: [
      { title: 'Bridge topic', pages: [7, 8, 9, 10] },
      { title: 'Later', pages: [11, 12] }
    ] } },
    { start: 9, end: 16, payload: { groups: [
      { title: 'Bridge topic', pages: [9, 10] },
      { title: 'Later', pages: [11, 12] }
    ] } }
  ];
  const groups = reconcileLectureWindowGroups(windows, 16);
  assert.deepEqual(groups.find(group => group.pages.includes(8))?.pages, [7, 8, 9, 10]);
  assert.deepEqual(groups.flatMap(group => group.pages),
    Array.from({ length: 16 }, (_, index) => index + 1));
});

test('global reconciliation prefers the central window on conflicting boundaries', () => {
  const windows = [
    { start: 1, end: 8, payload: { groups: [
      { title: 'Topic A', pages: [6, 7] }, { title: 'Topic B', pages: [8] }
    ] } },
    { start: 5, end: 12, payload: { groups: [
      { title: 'Topic A', pages: [6, 7, 8] }
    ] } }
  ];
  const groups = reconcileLectureWindowGroups(windows, 12);
  assert.deepEqual(groups.find(group => group.pages.includes(7))?.pages, [6, 7, 8]);
});

test('failed windows do not override valid neighbors or remove slides', () => {
  const windows = [
    { start: 1, end: 8, payload: null },
    { start: 5, end: 12, payload: { groups: [{ title: 'Crosses gap', pages: [7, 8, 9] }] } },
    { start: 9, end: 16, payload: { groups: [{ title: 'Final', pages: [12, 13] }] } }
  ];
  const groups = reconcileLectureWindowGroups(windows, 16);
  assert.deepEqual(groups.find(group => group.pages.includes(8))?.pages, [7, 8, 9]);
  assert.deepEqual(groups.flatMap(group => group.pages),
    Array.from({ length: 16 }, (_, index) => index + 1));
});

test('a long topic is split at four pages, not a fixed processing-window edge', () => {
  const windows = lectureGroupingWindows(13).map(w => ({
    ...w,
    payload: { groups: [{ title: 'Long continuous topic',
      pages: Array.from({ length: w.end - w.start + 1 }, (_, i) => w.start + i) }] }
  }));
  const groups = reconcileLectureWindowGroups(windows, 13);
  assert.deepEqual(groups.map(group => group.pages), [
    [1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13]
  ]);
  assert.ok(groups.every(group => group.pages.length <= LECTURE_GROUP_MAX_PAGES));
});

test('window prompt recognizes continuing topics and avoids invented hard batch boundaries', () => {
  const prompt = buildLectureGroupingPrompt({ start: 5, end: 12 });
  assert.match(prompt, /OVERLAPPING WINDOW/);
  assert.match(prompt, /not a self-contained chapter/);
  assert.match(prompt, /Do not invent topic boundaries/);
  assert.match(prompt, /5 through 12/);
});

test('the first grouping analysis sees the entire original PDF rather than 8-page chunks', () => {
  const prompt = buildWholeDocumentLectureGroupingPrompt({ pageCount: 48, language: 'German' });
  assert.match(prompt, /ENTIRE attached lecture PDF/);
  assert.match(prompt, /1-based page numbers from 1 to 48/);
  assert.match(prompt, /pages 8 and 9/);
  assert.match(prompt, /natural concept transitions/);
  assert.match(prompt, /Write titles in German/);
  assert.ok(prompt.includes(String.fromCharCode(10)), 'instructions must have readable real newlines');
});

test('a severely incomplete or empty global outline falls back instead of fragmenting the lecture', () => {
  assert.equal(isUsableLectureOutline(null, 10), false);
  assert.equal(isUsableLectureOutline({ groups: [] }, 10), false);
  assert.equal(isUsableLectureOutline({ groups: [{ title: 'Too short', pages: [1, 2] }] }, 10), false);
  assert.equal(isUsableLectureOutline({ groups: [{ title: 'Good coverage', pages: [1, 2, 3, 4, 5, 6, 7] }] }, 10), true);
  assert.equal(isUsableLectureOutline({ groups: [{ title: 'All', pages: [1] }] }, 1), true);
});

test('whole-PDF analysis is primary and overlapping image windows are fallback only', async () => {
  const app = await readFile(new URL('../slidesToAnki/app.js', import.meta.url), 'utf8');
  const primary = app.indexOf('pdfBase64: arrayBufferToBase64(buffer)', app.indexOf('async function generateLectureCards('));
  const text = app.indexOf('completeText = lectureTextContext', app.indexOf('async function generateLectureCards('));
  const window = app.indexOf('const windows = lectureGroupingWindows(pdf.numPages)', app.indexOf('async function generateLectureCards('));
  assert.ok(primary >= 0 && primary < text && text < window, 'whole PDF should be tried before text and windows');
  assert.match(app, /if \(!groups\) \{\s*const windows = lectureGroupingWindows/);
  assert.match(app, /isUsableLectureOutline\(payload, pdf\.numPages, 0\.3\)/);
  assert.match(app, /pdfBase64: arrayBufferToBase64\(buffer\)/);
  assert.match(app, /buffer\.byteLength <= PDF_INLINE_SAFETY_LIMIT/);
});
