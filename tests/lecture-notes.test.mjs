import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  LECTURE_GROUP_BATCH_PAGES,
  LECTURE_GROUP_OVERLAP_PAGES,
  lectureGroupingWindows,
  reconcileLectureWindowGroups,
  LECTURE_GROUP_MAX_PAGES,
  normalizeLectureGroups,
  buildLectureGroupingPrompt,
  buildLectureExplanationPrompt,
  normalizeLectureExplanation,
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
  for (const phrase of ['EVERY supplied original PDF page', 'equations', 'diagrams', 'misconceptions', 'ORIGINAL page number', 'substantial']) {
    assert.ok(explaining.includes(phrase), 'Missing deep explanation prompt guidance: ' + phrase);
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

test('Anki backs place ALL original images before full PDF text and AI explanation', () => {
  const pdfText = 'First part\nSecond part <tag> & "quoted"';
  const card = {
    pages: [3, 4],
    textByPage: { 3: pdfText, 4: 'Text from page four' },
    explanation: { overview: 'Overview', explanation: 'Why it matters.\n\nWorked example.', keyPoints: ['Remember this'] }
  };
  const html = lectureBackHtml(card, new Map([[3, 'source3.jpg'], [4, 'source4.jpg']]));
  const firstImage = html.indexOf('source3.jpg');
  const secondImage = html.indexOf('source4.jpg');
  const fullText = html.indexOf('Full extracted PDF text');
  const deep = html.indexOf('Detailed explanation');
  assert.ok(firstImage >= 0 && firstImage < secondImage && secondImage < fullText && fullText < deep);
  assert.ok(html.includes('First part\nSecond part'));
  assert.ok(html.includes('Text from page four'));
  assert.ok(html.includes('&lt;tag&gt; &amp; &quot;quoted&quot;'));
  assert.ok(html.includes('Why it matters.') && html.includes('Worked example.'));
});

test('Anki back renderer keeps images for every page even if extractable text is missing', () => {
  const card = {
    pages: [12],
    textByPage: { 12: '' },
    explanation: { explanation: 'Visual explanation' }
  };
  const html = lectureBackHtml(card, new Map([[12, 'page12.jpg']]));
  assert.ok(html.includes('No selectable PDF text'));
  assert.ok(html.includes('Visual explanation'));
  assert.throws(() => lectureBackHtml(card, new Map()), /Source image/);
});

test('lecture notes render PDF and model text escaped rather than executable HTML', () => {
  const html = lectureBackHtml({
    pages: [1],
    textByPage: { 1: '<script>window.fail = true</script>' },
    explanation: { explanation: '<img src=x onerror=alert(1)>', keyPoints: ['<b>raw</b>'] }
  }, new Map([[1, 'safe.jpg']]));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('&lt;b&gt;'));
  assert.equal(html.includes('<script>'), false);
});

test('app routes PDF lecture mode to separate visual grouping and Anki export', async () => {
  const app = await readFile(new URL('../slidesToAnki/app.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../slidesToAnki/gemini-anki.html', import.meta.url), 'utf8');
  assert.match(html, /value="lecture"/);
  assert.match(app, /ui\.cardMode\.value === 'lecture'/);
  assert.match(app, /await generateLectureCards\(client, model, pdf\)/);
  assert.match(app, /forceAll: lecture/);
  assert.match(app, /lectureBackHtml\(card, media\)/);
  assert.match(app, /imageCache\?\.get\(page\)/);
  assert.match(app, /extractLecturePageText\(pdf, page\)/);
  assert.match(app, /control\.disabled = lectureMode/);
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
