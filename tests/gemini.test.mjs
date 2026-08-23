import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MODEL,
  GeminiClient,
  chooseModel,
  classifyApiError,
  extractJsonValue,
  mergeModelLists,
  modelMetadata,
  parseModelList
} from '../slidesToAnki/lib/gemini.js';

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

test('Gemini 3.7 Flash is the preferred free multimodal default', () => {
  assert.equal(DEFAULT_MODEL, 'gemini-3.7-flash');
  const meta = modelMetadata(DEFAULT_MODEL);
  assert.equal(meta.freeTier, true);
  assert.equal(meta.pdf, true);
  assert.equal(meta.imageInput, true);
});

test('model discovery keeps all generateContent models but sorts useful free PDF models first', () => {
  const models = parseModelList({ models: [
    { name: 'models/gemini-3.7-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.1-flash-image', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }
  ] });
  assert.deepEqual(models.map(model => model.id), ['gemini-3.7-flash', 'gemini-2.5-flash', 'gemini-3.1-flash-image']);
});

test('fallback merge is deduplicated and default selection is stable', () => {
  const models = mergeModelLists([{ id: 'gemini-2.5-flash' }, { id: 'gemini-3.7-flash' }]);
  assert.equal(new Set(models.map(model => model.id)).size, models.length);
  assert.equal(chooseModel(models), DEFAULT_MODEL);
  assert.equal(chooseModel(models, 'gemini-2.5-flash'), 'gemini-2.5-flash');
});

test('extractJsonValue accepts fenced JSON and minor trailing commas', () => {
  assert.deepEqual(extractJsonValue('```json\n{"cards":[{"front":"Q","back":"A",}],}\n```'), { cards: [{ front: 'Q', back: 'A' }] });
});

test('rate-limit classification respects retry-after', () => {
  const response = new Response('', { status: 429, headers: { 'retry-after': '3' } });
  assert.deepEqual(classifyApiError(429, 'quota', response), { kind: 'rate-limit', retry: true, cooldownMs: 3000 });
  assert.equal(classifyApiError(403, 'invalid key').kind, 'auth');
  assert.equal(classifyApiError(400, 'bad').retry, false);
});

test('listModels authenticates via header, paginates, and never places API key in URL', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) return jsonResponse({ models: [{ name: 'models/gemini-3.7-flash', supportedGenerationMethods: ['generateContent'] }], nextPageToken: 'next' });
    return jsonResponse({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] });
  };
  const client = new GeminiClient('secret-key', { fetchImpl, sleepImpl: async () => {} });
  const models = await client.listModels();
  assert.equal(calls.length, 2);
  assert.ok(calls[1].url.includes('pageToken=next'));
  for (const call of calls) {
    assert.equal(call.url.includes('secret-key'), false);
    assert.equal(call.init.headers['x-goog-api-key'], 'secret-key');
  }
  assert.equal(models[0].id, DEFAULT_MODEL);
});

test('generate sends PDFs as application/pdf inlineData and parses JSON response', async () => {
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return jsonResponse({ candidates: [{ content: { parts: [{ text: '{"cards":[{"front":"Q","back":"A","pages":[1]}]}' }] } }] });
  };
  const client = new GeminiClient('secret-key', { fetchImpl, sleepImpl: async () => {} });
  const result = await client.generateJson({ prompt: 'make cards', pdfBase64: 'AA==', model: DEFAULT_MODEL });
  const body = JSON.parse(captured.init.body);
  assert.equal(captured.url.includes('secret-key'), false);
  assert.equal(captured.init.headers['x-goog-api-key'], 'secret-key');
  assert.equal(body.contents[0].parts[1].inlineData.mimeType, 'application/pdf');
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(result.cards[0].front, 'Q');
});
