import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  escapeHtml, normalizePages, stableNumericId, safeDeckName
} from '../slidesToAnki/lib/anki-utils.js';
import {
  buildWholeDocumentLectureGroupingPrompt, isUsableLectureOutline,
  normalizeLectureGroups, lectureGroupingWindows, reconcileLectureWindowGroups,
  buildLectureGroupingPrompt, buildLectureExplanationPrompt,
  normalizeLectureExplanation, legacyLectureNoteFields,
  buildLegacyLectureAnnotationPrompt
} from '../slidesToAnki/lib/lecture-notes.js';
import { normalizeSettings } from '../slidesToAnki/lib/settings.js';

async function createHarness({ slideBySlide = false, includeText = true } = {}) {
  const source = await readFile(new URL('../slidesToAnki/app.js', import.meta.url), 'utf8');
  // The dedicated startup suite parses the unmodified ES module first.
  const app = source.replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm, '');
  const inputs = {
    'model-select': 'gemini-2.5-flash', 'card-mode': 'lecture',
    'api-keys': 'dummy', 'language': 'auto', 'strategy': 'direct',
    'density': 'compact', 'max-source-images': 'all',
    'legacy-max-resolution': '1800', 'legacy-max-kb': '500',
    'legacy-parallelism': '10'
  };
  const checked = {
    'legacy-include-text': includeText, 'legacy-slide-by-slide': slideBySlide,
    'legacy-compress-images': true, 'legacy-auto-crop': false
  };
  const nodes = new Map();
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, {
      id, value: inputs[id] || '', checked: checked[id] || false,
      hidden: false, disabled: false, innerHTML: '', textContent: '',
      style: {}, listeners: {}, dataset: {},
      classList: { toggle() {}, add() {}, remove() {} },
      addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); },
      setAttribute() {}, click() {}
    });
    return nodes.get(id);
  };
  const tabs = ['pdf', 'text', 'json', 'slides'];
  const document = {
    getElementById: element,
    querySelectorAll(q) {
      const isTab = q === '[data-input-tab]';
      return tabs.map(tab => ({
        dataset: isTab ? { inputTab: tab } : { inputPanel: tab },
        hidden: false, classList: { toggle() {} }, setAttribute() {}, addEventListener() {}
      }));
    },
    body: { dataset: {} },
    createElement(kind) {
      assert.equal(kind, 'canvas');
      return {
        width: 0, height: 0,
        getContext() { return { drawImage() {} }; },
        toBlob(callback) {
          callback({ arrayBuffer: async () => new Uint8Array([255, 216, 255, 217]).buffer });
        }
      };
    }
  };
  const pdf = {
    numPages: 6,
    async getPage(page) {
      return {
        getViewport({ scale }) { return { width: 600 * scale, height: 400 * scale }; },
        render() { return { promise: Promise.resolve() }; },
        async getTextContent() { return { items: [{ str: 'Original searchable PDF page ' + page, hasEOL: true }] }; }
      };
    }
  };
  const pdfjsLib = { GlobalWorkerOptions: {},
    getDocument() { return { promise: Promise.resolve(pdf) }; } };
  const window = { SQL: {}, pdfjsLib: true };
  const localStorage = { getItem() { return null; }, setItem() {} };
  const Model = class {
    constructor(configuration) { this.configuration = configuration; Model.last = this; }
    note(fields, tags) { return { fields, tags }; }
  };
  const Deck = class {
    constructor() { this.notes = []; }
    addNote(note) { this.notes.push(note); }
  };
  const Package = class {
    constructor() { this.decks = []; this.images = []; this.outputs = []; Package.last = this; }
    addDeck(deck) { this.decks.push(deck); }
    addMedia(_bytes, filename) { this.images.push(filename); }
    async writeToFile(filename) { this.outputs.push(filename); }
  };
  const mocks = {
    document, window, localStorage, pdfjsLib, Model, Deck, Package,
    location: { search: '' }, URLSearchParams: class { get() { return null; } },
    btoa: value => value,
    DEFAULT_MODEL: 'gemini-2.5-flash',
    fallbackModelList: () => [{ id: 'gemini-2.5-flash' }],
    mergeModelLists: x => x,
    chooseModel: () => 'gemini-2.5-flash',
    normalizeModelId: x => x,
    modelLabel: model => model.id,
    modelMetadata: () => ({ pdf: true, imageInput: true }),
    escapeHtml, normalizePages, stableNumericId, safeDeckName,
    loadSettings: () => normalizeSettings({ cardMode: 'lecture' }),
    saveSettings: () => {},
    GeminiClient: class { async listModels() { return []; } },
    buildWholeDocumentLectureGroupingPrompt, isUsableLectureOutline,
    normalizeLectureGroups, lectureGroupingWindows, reconcileLectureWindowGroups,
    buildLectureGroupingPrompt, buildLectureExplanationPrompt,
    normalizeLectureExplanation, legacyLectureNoteFields,
    buildLegacyLectureAnnotationPrompt
  };
  for (const name of ['buildPdfCardPrompt', 'buildSlideExplanationPrompt',
    'normalizeSlideExplanations', 'buildTextCardPrompt', 'cardBackHtml', 'normalizeCards']) {
    mocks[name] = () => {};
  }
  const instance = new Function(...Object.keys(mocks),
    app + '\nreturn { processPdf, ui };')(...Object.values(mocks));
  // Settings initialization may set the defaults; intentionally override the
  // mode toggles to test each legacy configuration explicitly.
  instance.ui.legacyIncludeText.checked = includeText;
  instance.ui.legacySlideBySlide.checked = slideBySlide;
  return { ...instance, Model, Package };
}

test('original PDF export keeps Text searchable but never on its Anki cards', async () => {
  const harness = await createHarness();
  const requests = [];
  const client = {
    async generateJson(request) {
      requests.push(request);
      if (request.pdfBase64) return { groups: [
        { title: 'Original grouped topic', pages: [2, 4, 5] }
      ] };
      return { explanation: '<p>Explanation <b>fully</b>.</p>' };
    }
  };
  await harness.processPdf({ name: 'lecture.pdf', size: 10,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }, 0, 1, client, 'gemini-2.5-flash');
  const packageObject = harness.Package.last;
  const note = packageObject.decks[0].notes[0];
  const model = harness.Model.last.configuration;
  assert.deepEqual(model.flds.map(field => field.name),
    ['Order', 'Front', 'Back', 'BackContent', 'Text']);
  assert.equal(model.tmpls[0].qfmt, '{{Front}}');
  assert.equal(model.tmpls[0].afmt,
    '{{FrontSide}}<hr id=answer>{{Back}}<br><div class="back-content">{{BackContent}}</div>');
  assert.ok(!model.tmpls[0].qfmt.includes('{{Text}}'));
  assert.ok(!model.tmpls[0].afmt.includes('{{Text}}'));
  assert.equal(note.fields[1], 'Original grouped topic');
  assert.ok(note.fields[2].includes('studytools_0_0002.jpg'));
  assert.ok(note.fields[2].includes('studytools_0_0004.jpg'));
  assert.ok(note.fields[2].includes('studytools_0_0005.jpg'));
  assert.equal(note.fields[3], '<p>Explanation <b>fully</b>.</p>');
  assert.ok(note.fields[4].includes('Original searchable PDF page 2'));
  assert.ok(note.fields[4].includes('Original searchable PDF page 5'));
  assert.ok(!note.fields[2].includes('Original searchable PDF'));
  assert.ok(!note.fields[3].includes('Original searchable PDF'));
  assert.equal(packageObject.images.length, 3);
  assert.deepEqual(packageObject.outputs, ['lecture.apkg']);
  assert.equal(requests.filter(request => request.pdfBase64).length, 1);
});

test('original slide-by-slide mode adds per-image annotations and no group explanation', async () => {
  const harness = await createHarness({ slideBySlide: true, includeText: false });
  let annotationRequests = 0;
  const client = {
    async generateJson(request) {
      if (request.pdfBase64) return { groups: [{ title: 'Illustration', pages: [2, 3] }] };
      annotationRequests++;
      return { annotation: annotationRequests === 1 ? 'Diagram clarification' : '' };
    }
  };
  await harness.processPdf({ name: 'slides.pdf', size: 10,
    arrayBuffer: async () => new Uint8Array([1]).buffer }, 0, 1, client, 'gemini-2.5-flash');
  const fields = harness.Package.last.decks[0].notes[0].fields;
  assert.equal(fields[3], '');
  assert.equal(fields[4], '');
  assert.ok(fields[2].includes('slide-annotation'));
  assert.ok(fields[2].includes('Diagram clarification'));
  assert.equal(annotationRequests, 2);
});
