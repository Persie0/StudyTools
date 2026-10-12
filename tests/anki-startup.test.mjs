import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

// Test the real ES-module grammar, not a stripped-import approximation.
// The old test harness silently removed imports, missing a duplicate imported
// binding that caused the browser to reject app.js before any handlers ran.
const source = async name => readFile(new URL('../slidesToAnki/' + name, import.meta.url), 'utf8');

test('all entrypoint imports parse as real ES modules (no duplicate imported identifiers)', async () => {
  for (const path of ['app.js', 'lib/gemini.js', 'lib/anki-utils.js', 'lib/settings.js', 'lib/lecture-notes.js']) {
    const src = await source(path);
    const check = spawnSync(process.execPath, ['--check', '--input-type=module'], {
      input: src, encoding: 'utf8'
    });
    assert.equal(check.status, 0, path + ': ' + check.stderr);
  }
  // Prove this test would have caught the reported production regression.
  const broken = (await source('app.js')).replace(
    "  buildLectureExplanationPrompt,",
    "  buildLectureExplanationPrompt,\n  normalizeLectureGroups,"
  );
  const check = spawnSync(process.execPath, ['--check', '--input-type=module'], {
    input: broken, encoding: 'utf8'
  });
  assert.notEqual(check.status, 0);
  assert.match(check.stderr, /normalizeLectureGroups|already been declared/);
});

test('all app DOM IDs exist and PDF upload controls are connected', async () => {
  const [app, html] = await Promise.all([source('app.js'), source('gemini-anki.html')]);
  const htmlIds = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(htmlIds.length, new Set(htmlIds).size, 'Duplicate HTML ID found');
  const ids = new Set(htmlIds);
  for (const [, id] of app.matchAll(/\$\('([^']+)'\)/g)) {
    assert.ok(ids.has(id), 'Missing DOM node: ' + id);
  }
  assert.match(app, /ui\.fileInput\.addEventListener\('change', event => addFiles\(event\.target\.files\)\)/);
  assert.match(app, /ui\.choosePdfs\.addEventListener\('click'/);
  assert.match(app, /ui\.dropzone\.addEventListener\('drop', event => addFiles\(event\.dataTransfer\.files\)\)/);
});

test('card controls hide irrelevant fields and stay within responsive layout', async () => {
  const [app, html, css] = await Promise.all([
    source('app.js'), source('gemini-anki.html'), source('gemini-anki.css')
  ]);
  for (const id of ['standard-card-density', 'standard-pdf-reading', 'standard-image-options', 'legacy-lecture-options', 'legacy-include-text', 'legacy-detailed-grouping', 'legacy-slide-by-slide']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  for (const id of ['standardCardDensity', 'standardPdfReading', 'standardImageOptions']) {
    assert.match(app, new RegExp('ui\\.' + id + '\\.hidden = lectureMode'));
  }
  assert.match(css, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /\[hidden\]\s*\{\s*display:none !important;/);
  assert.match(css, /\.tabs\s*\{[^}]*flex-wrap:wrap/);
});

test('init, PDF selection, and style switching still work without network', async () => {
  const src = await source('app.js');
  // Only strip imports *after* syntax is independently checked as ESM above.
  const app = src.replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm, '');
  const nodes = new Map();
  function el(id) {
    if (!nodes.has(id)) nodes.set(id, {
      id, value: '', checked: false, disabled: false, hidden: false,
      textContent: '', innerHTML: '', style: {}, dataset: {}, listeners: {},
      classList: { toggle() {}, add() {}, remove() {} },
      addEventListener(type, listener) {
        (this.listeners[type] ||= []).push(listener);
      },
      setAttribute() {},
      click() { this.wasClicked = true; }
    });
    return nodes.get(id);
  }
  const tabs = ['pdf', 'text', 'json', 'slides'].map(inputTab => ({
    dataset: { inputTab }, classList: { toggle() {} },
    setAttribute() {}, addEventListener(type, fn) { this['on' + type] = fn; }
  }));
  const panels = ['pdf', 'text', 'json', 'slides'].map(inputPanel => ({
    dataset: { inputPanel }, hidden: false
  }));
  const document = {
    getElementById: el,
    querySelectorAll(selector) {
      return selector === '[data-input-tab]' ? tabs : panels;
    },
    body: { dataset: {} }
  };
  const storage = new Map([['studytoolsGeminiKeysV2', 'test-api-key']]);
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, String(value)); },
    removeItem: key => storage.delete(key)
  };
  // Supply only the dependencies used during startup. No Gemini requests.
  const mocks = {
    document, localStorage,
    window: { pdfjsLib: false },
    location: { search: '' },
    URLSearchParams: class { get() { return null; } },
    DEFAULT_MODEL: 'gemini-2.5-flash',
    fallbackModelList: () => [{ id: 'gemini-2.5-flash' }],
    mergeModelLists: models => models,
    chooseModel: () => 'gemini-2.5-flash',
    normalizeModelId: id => id,
    modelLabel: model => model.id,
    modelMetadata: () => ({ pdf: true, imageInput: true, freeTier: true }),
    escapeHtml: text => String(text),
    loadSettings: () => null,
    saveSettings: () => {},
    GeminiClient: class { async listModels() { return [{ id: 'gemini-2.5-flash' }]; } }
  };
  // Stub the other imports, which are referenced only after generation.
  for (const dependency of [
    'buildPdfCardPrompt', 'buildSlideExplanationPrompt', 'normalizeSlideExplanations',
    'buildTextCardPrompt', 'cardBackHtml', 'normalizeCards', 'safeDeckName',
    'stableNumericId', 'lectureGroupingWindows',
    'buildWholeDocumentLectureGroupingPrompt', 'isUsableLectureOutline',
    'normalizeLectureGroups', 'reconcileLectureWindowGroups',
    'buildLectureGroupingPrompt', 'buildLectureExplanationPrompt',
    'normalizeLectureExplanation', 'legacyLectureNoteFields', 'buildLegacyLectureAnnotationPrompt'
  ]) mocks[dependency] = () => {};
  const run = new Function(...Object.keys(mocks),
    app + '\nreturn { state, ui, switchInput, updateGenerateState };');
  const { state, ui, switchInput } = run(...Object.values(mocks));
  assert.equal(state.activeInput, 'pdf');
  assert.ok(ui.fileInput.listeners.change?.length, 'PDF input is not bound');
  assert.ok(ui.choosePdfs.listeners.click?.length, 'Choose PDFs is not bound');

  ui.fileInput.listeners.change[0]({
    target: { files: [{ name: 'lecture.pdf', type: 'application/pdf', size: 1400 }] }
  });
  assert.equal(state.files.length, 1);
  assert.equal(ui.generate.disabled, false, 'PDF upload should enable generation with a key');

  ui.cardMode.value = 'lecture';
  ui.cardMode.listeners.change[0]();
  assert.equal(ui.legacyOptions.hidden, false);
  assert.equal(ui.standardCardDensity.hidden, true);
  assert.equal(ui.standardPdfReading.hidden, true);
  assert.equal(ui.standardImageOptions.hidden, true);

  switchInput('text');
  assert.equal(ui.standardCardDensity.hidden, false);
  assert.equal(ui.standardImageOptions.hidden, false);
  switchInput('pdf');
  ui.cardMode.value = 'topics';
  ui.cardMode.listeners.change[0]();
  assert.equal(ui.standardCardDensity.hidden, false);
  assert.equal(ui.strategy.disabled, false);
});
