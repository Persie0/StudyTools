import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  LECTURE_GROUP_BATCH_PAGES,
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
  for (const phrase of ['EVERY supplied original PDF page', 'equations', 'diagrams', 'misconceptions', 'Page N', 'substantial']) {
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
