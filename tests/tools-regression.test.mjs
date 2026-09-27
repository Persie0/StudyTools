import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('every landing-page tool has a page and its expected core controls', async () => {
  const index = await read('index.html');
  const [splitter, stripper, anki, converter] = await Promise.all([
    read('pdfSplitter/pdf-splitter.html'),
    read('pdfPageStripper/stripper.html'),
    read('slidesToAnki/slidesanki.html'),
    read('slidesToAnki/gemini-anki.html')
  ]);
  for (const route of [
    './pdfSplitter/pdf-splitter.html',
    './pdfPageStripper/stripper.html',
    './slidesToAnki/slidesanki.html',
    './slidesToAnki/gemini-anki.html'
  ]) assert.ok(index.includes(route), `missing landing route: ${route}`);

  assert.match(splitter, /levelSelect|level-select/i);
  assert.match(splitter, /splitButton|split-button/i);
  assert.match(stripper, /wordComparisonMode/);
  assert.match(stripper, /compressPDF/);
  assert.match(anki, /slidesanki\.html|file-input/i);
  assert.match(converter, /data-input-tab="pdf"/);
  assert.match(converter, /data-input-tab="text"/);
  assert.match(converter, /data-input-tab="json"/);
  assert.match(converter, /data-input-tab="slides"/);
});

test('each browser tool loads its local processing code and required PDF libraries', async () => {
  const splitter = await read('pdfSplitter/pdf-splitter.html');
  const stripper = await read('pdfPageStripper/stripper.html');
  const stripperScript = await read('pdfPageStripper/scripts.js');
  const legacySlides = await read('slidesToAnki/slidesanki.html');
  const converter = await read('slidesToAnki/gemini-anki.html');
  const app = await read('slidesToAnki/app.js');

  assert.match(splitter, /pdf-lib\.min\.js/);
  assert.match(splitter, /pdf\.min\.mjs/);
  assert.match(stripper, /scripts\.js/);
  assert.match(stripperScript, /createProcessedPDF/);
  assert.match(stripperScript, /includesContent|includesAllWords/);
  assert.match(legacySlides, /scripts\.js|app\.js/);
  assert.match(converter, /app\.js/);
  assert.match(converter, /pdf-lib\.min\.js/);
  assert.match(app, /generateCardsFromImages/);
  assert.match(app, /processSlides/);
});

test('AI mode tells users where their content goes while local tools remain client-side', async () => {
  const index = await read('index.html');
  const converter = await read('slidesToAnki/gemini-anki.html');
  const splitterScript = await read('pdfSplitter/pdf-splitter.html');
  const stripperScript = await read('pdfPageStripper/scripts.js');
  assert.match(index, /sent directly from your browser to Google Gemini/i);
  assert.match(converter, /sent directly to Google Gemini/i);
  assert.match(splitterScript, /PDFDocument\.load/);
  assert.match(stripperScript, /PDFLib\.PDFDocument\.load/);
});
