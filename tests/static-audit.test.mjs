import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('primary AI converter is Gemini-only and uses shared module code', async () => {
  const html = await read('slidesToAnki/gemini-anki.html');
  const app = await read('slidesToAnki/app.js');
  assert.match(html, /PDF study modes|Gemini.*Anki|Slide explanations/i);
  assert.doesNotMatch(html + app, /NVIDIA NIM|OpenRouter|corsproxy/i);
  assert.doesNotMatch(html + app, /gemini-2\.0-flash/);
  assert.match(app, /\.\/lib\/gemini\.js/);
});

test('privacy copy does not claim AI PDFs stay local', async () => {
  const html = await read('slidesToAnki/gemini-anki.html');
  assert.match(html, /send the selected content to Google Gemini/i);
  assert.doesNotMatch(html, /files are never uploaded/i);
});

test('landing page privacy language is accurate and old entry points converge on the unified converter', async () => {
  const index = await read('index.html');
  const topics = await read('slidesToAnki/gemini-anki-topics.html');
  const json = await read('jsonToAnki/jsonToAnki.html');
  assert.match(index, /sent directly from your browser to Google Gemini/i);
  assert.doesNotMatch(index, /never uploaded/i);
  assert.match(topics, /gemini-anki\.html\?mode=topics/);
  assert.match(json, /gemini-anki\.html\?input=json/);
});
