import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_MODEL,
  GeminiClient,
  chooseModel,
  classifyApiError,
  extractJsonValue,
  mergeModelLists,
  modelMetadata,
  parseModelList,
  parseApiKeys
} from '../slidesToAnki/lib/gemini.js';

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

test('legacy Gemini 2.5 Flash remains the default PDF model', () => {
  assert.equal(DEFAULT_MODEL, 'gemini-2.5-flash');
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
  assert.deepEqual(models.map(model => model.id), ['gemini-2.5-flash', 'gemini-3.7-flash', 'gemini-3.1-flash-image']);
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


test('native browser fetch keeps the global Window receiver', async () => {
  let called = 0;
  function browserFetch(url, init) {
    assert.equal(this, globalThis, 'native fetch must be called with the global receiver');
    assert.match(url, /generativelanguage\.googleapis\.com/);
    assert.equal(init.headers['x-goog-api-key'], 'test-key');
    called++;
    return Promise.resolve(jsonResponse({ models: [] }));
  }
  const client = new GeminiClient('test-key', { fetchImpl: browserFetch });
  assert.deepEqual(await client.listModels(), []);
  assert.equal(called, 1);
});

test('illegal invocation is not misclassified as a retryable API failure', async () => {
  let called = 0;
  const client = new GeminiClient('test-key', {
    fetchImpl() {
      called++;
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    },
    sleepImpl: async () => {}
  });
  await assert.rejects(client.listModels(), /Illegal invocation/);
  assert.equal(called, 1);
});

test('PDF-to-Anki defaults match the controls from before the UI redesign', async () => {
  const html = await readFile(new URL('../slidesToAnki/gemini-anki.html', import.meta.url), 'utf8');
  for (const pattern of [
    /id="density"[^>]*><option value="compact" selected>/,
    /id="card-mode"[^>]*><option value="questions">Questions<\/option><option value="topics" selected>/,
    /id="strategy"[^>]*><option value="auto">[^<]*<\/option><option value="direct" selected>/,
    /id="language"[^>]*><option value="auto" selected>/,
    /id="include-images"[^>]*type="checkbox" checked/,
    /id="max-source-images"[^>]*>.*?<option value="all" selected>/
  ]) assert.match(html, pattern);
});

test('API key parsing handles quoted environment variables and duplicate multiline keys', () => {
  assert.deepEqual(parseApiKeys('\uFEFFGEMINI_API_KEY="AIza-test-1"\n# ignored\nAIza-test-1,AIza-test-2\nexport GOOGLE_API_KEY=\'AIza-test-3\''), [
    'AIza-test-1', 'AIza-test-2', 'AIza-test-3'
  ]);
});

test('Google HTTP 400 API_KEY_INVALID is an authentication error, not a payload error', () => {
  assert.equal(classifyApiError(400, 'API_KEY_INVALID API key not valid. Please pass a valid API key.').kind, 'auth');
  assert.equal(classifyApiError(400, 'unknown field generationConfig').kind, 'bad-request');
});

test('a rejected first key falls through to the next valid key without repeating the request', async () => {
  const used = [];
  const fetchImpl = async (_url, init) => {
    used.push(init.headers['x-goog-api-key']);
    if (used.length === 1) return jsonResponse({
      error: {
        message: 'API key not valid. Please pass a valid API key.',
        status: 'INVALID_ARGUMENT',
        details: [{ reason: 'API_KEY_INVALID' }]
      }
    }, 400);
    return jsonResponse({ candidates: [{ content: { parts: [{ text: '{"cards":[]}' }] } }] });
  };
  const client = new GeminiClient('bad-key\ngood-key', { fetchImpl });
  assert.deepEqual(await client.generateJson({ model: DEFAULT_MODEL, prompt: 'test' }), { cards: [] });
  assert.deepEqual(used, ['bad-key', 'good-key']);
});

test('all invalid keys fail with a helpful error without exposing key strings', async () => {
  const calls = [];
  const client = new GeminiClient('private-key-1\nprivate-key-2', {
    fetchImpl: async (_url, init) => {
      calls.push(init.headers['x-goog-api-key']);
      return jsonResponse({ error: { message: 'API key not valid.', details: [{ reason: 'API_KEY_INVALID' }] } }, 400);
    }
  });
  await assert.rejects(client.listModels(), error => {
    assert.match(error.message, /API key #2/);
    assert.match(error.message, /Google AI Studio/);
    assert.doesNotMatch(error.message, /private-key/);
    return true;
  });
  assert.deepEqual(calls, ['private-key-1', 'private-key-2']);
});

test('checkKeys probes every key without file upload and reports independent results', async () => {
  const calls = [];
  const client = new GeminiClient('invalid-key\ngood-key', {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (init.headers['x-goog-api-key'] === 'invalid-key') {
        return jsonResponse({ error: { message: 'API key not valid.', details: [{ reason: 'API_KEY_INVALID' }] } }, 400);
      }
      return jsonResponse({ models: [] });
    }
  });
  const results = await client.checkKeys();
  assert.deepEqual(results.map(result => [result.index, result.ok, result.kind]), [
    [1, false, 'auth'], [2, true, 'valid']
  ]);
  for (const { url, init } of calls) {
    assert.match(url, /\/v1beta\/models\?pageSize=1$/);
    assert.equal(init.method, 'GET');
    assert.equal(init.body, undefined);
    assert.doesNotMatch(url, /invalid-key|good-key/);
  }
});

test('bad payload falls back without responseMimeType but does not rotate API keys', async () => {
  const calls = [];
  const client = new GeminiClient('valid-key', {
    fetchImpl: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      if (calls.length === 1) return jsonResponse({ error: { message: 'Unknown name responseMimeType' } }, 400);
      return jsonResponse({ candidates: [{ content: { parts: [{ text: '{"cards":[]}' }] } }] });
    }
  });
  assert.deepEqual(await client.generateJson({ prompt: 'test' }), { cards: [] });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].generationConfig.responseMimeType, 'application/json');
  assert.equal(calls[1].generationConfig, undefined);
});
