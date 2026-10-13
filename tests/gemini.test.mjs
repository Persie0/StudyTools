import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_MODEL,
  GeminiClient,
  chooseModel,
  classifyApiError,
  extractJsonValue,
  repairModelJson,
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

test('checkKeys compares models.list and generateContent for each key, without uploading a file', async () => {
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
  const results = await client.checkKeys({ model: 'gemini-2.5-flash' });
  assert.deepEqual(results.map(result => [result.index, result.list.kind, result.generation.kind]), [
    [1, 'auth', 'auth'], [2, 'valid', 'valid']
  ]);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map(call => call.init.method), ['GET', 'POST', 'GET', 'POST']);
  for (const { url, init } of calls) {
    assert.equal(init.credentials, 'omit');
    assert.equal(init.cache, 'no-store');
    assert.doesNotMatch(url, /invalid-key|good-key/);
    if (init.method === 'POST') {
      assert.match(url, /gemini-2\.5-flash:generateContent$/);
      const body = JSON.parse(init.body);
      assert.equal(body.contents[0].parts[0].text, 'ping');
      assert.equal(body.generationConfig.maxOutputTokens, 8);
      assert.doesNotMatch(init.body, /private|PDF|lecture/);
    } else {
      assert.match(url, /\/v1beta\/models\?pageSize=1$/);
      assert.equal(init.body, undefined);
    }
  }
  for (const result of results) {
    assert.equal(result.model, 'gemini-2.5-flash');
    assert.equal(result.fingerprint === null || /^[0-9a-f]{16}$/.test(result.fingerprint), true);
    assert.equal(JSON.stringify(result).includes('invalid-key'), false);
    assert.equal(JSON.stringify(result).includes('good-key'), false);
  }
});

test('checkKeys differentiates model-list and generation failures', async () => {
  const client = new GeminiClient('secret-key', {
    fetchImpl: async (url) => url.includes('generateContent')
      ? jsonResponse({ error: { message: 'Model unavailable' } }, 404)
      : jsonResponse({ models: [] })
  });
  const [result] = await client.checkKeys();
  assert.equal(result.list.ok, true);
  assert.equal(result.generation.ok, false);
  assert.equal(result.generation.status, 404);
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

test('Gemini JSON repair preserves single-backslash LaTeX commands and MathJax', () => {
  const slash = String.fromCharCode(92);
  const math = slash + '(F=' + slash + 'frac{1}{2} + ' + slash + 'alpha + ' +
    slash + 'theta + ' + slash + 'sqrt{x} + ' + slash + 'beta + ' + slash + 'nabla f' + slash + ')';
  const malformed = JSON.stringify({ cards: [{ front: 'Formula', back: math, pages: [3] }] })
    .replaceAll(slash + slash, slash);
  const result = extractJsonValue(malformed);
  assert.equal(result.cards[0].back, math);
  assert.equal(result.cards[0].back.includes(String.fromCharCode(12)), false);
  assert.equal(result.cards[0].back.includes(String.fromCharCode(9)), false);
});

test('Gemini JSON repair leaves properly escaped LaTeX, newlines and quotations intact', () => {
  const slash = String.fromCharCode(92);
  const value = { cards: [{ front: 'Line one' + String.fromCharCode(10) + 'Line two',
    back: slash + '(a ' + slash + 'frac{b}{c}' + slash + ') and "quoted" text', pages: [1] }] };
  const correct = JSON.stringify(value);
  assert.equal(repairModelJson(correct), correct);
  assert.deepEqual(extractJsonValue(correct), value);
});

test('Gemini JSON repair ignores commas inside quoted fields and removes structural trailing commas', () => {
  const slash = String.fromCharCode(92);
  const malformed = JSON.stringify({
    cards: [{ front: 'a,]}', back: slash + 'sum_{i=0}^{n} x_i', pages: [2] }]
  }).replaceAll(slash + slash, slash)
    .replace('"pages":[2]', '"pages":[2,]')
    .replace(',"pages":[2,]}', ',"pages":[2,],}')
    .replace('}]}', '},],}');
  assert.deepEqual(extractJsonValue(' ```json' + String.fromCharCode(10) + malformed + '```'), {
    cards: [{ front: 'a,]}', back: slash + 'sum_{i=0}^{n} x_i', pages: [2] }]
  });
});

test('Gemini JSON repair handles unescaped newlines and preserves unicode escapes', () => {
  const slash = String.fromCharCode(92);
  const original = JSON.stringify({ cards: [{ front: 'first' + String.fromCharCode(10) + 'second',
    back: 'accent é' }] });
  const malformed = original.replace(slash + 'n', String.fromCharCode(10));
  assert.deepEqual(extractJsonValue(malformed).cards[0], {
    front: 'first' + String.fromCharCode(10) + 'second', back: 'accent é'
  });
  assert.equal(extractJsonValue('{"cards":[{"front":"\\u00e9","back":"ok"}]}').cards[0].front, 'é');
});

test('Gemini JSON repair reports incomplete or irrecoverable output without leaking response content', () => {
  assert.throws(() => extractJsonValue('{"cards":[{"front":"foo"'), /incomplete JSON|malformed JSON/);
  assert.throws(() => extractJsonValue('{"cards":[{"front":"secret","back":}]}'), error => {
    assert.match(error.message, /malformed JSON/);
    assert.doesNotMatch(error.message, /secret/);
    return true;
  });
});

test('GeminiClient.generateJson recovers malformed escaped LaTeX in the actual response path', async () => {
  const slash = String.fromCharCode(92);
  const back = slash + '(x=' + slash + 'frac{1}{2}' + slash + ')';
  const malformed = JSON.stringify({ cards: [{ front: 'Math', back, pages: [1] }] })
    .replaceAll(slash + slash, slash);
  const client = new GeminiClient('test-key', {
    fetchImpl: async () => jsonResponse({ candidates: [{ content: { parts: [{ text: malformed }] } }] })
  });
  assert.equal((await client.generateJson({ prompt: 'Summarize math' })).cards[0].back, back);
});


test('minute quota parses Google RetryInfo with fractional seconds and resource exhausted', async () => {
  let now = 100_000;
  const sleeps = [];
  const statuses = [];
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) return jsonResponse({
      error: {
        code: 429, message: 'Resource has been exhausted. Please retry in 1.5s.',
        status: 'RESOURCE_EXHAUSTED',
        details: [
          { '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel', description: 'Limit 20 per minute' }] },
          { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '1.5s' }
        ]
      }
    }, 429);
    return jsonResponse({ candidates: [{ content: { parts: [{ text: '{"groups":[]}' }] } }] });
  };
  const client = new GeminiClient('same-key', {
    fetchImpl,
    nowImpl: () => now,
    sleepImpl: async ms => { sleeps.push(ms); now += ms; },
    onRetry: status => statuses.push(status)
  });
  assert.deepEqual(await client.generateJson({ prompt: 'group all pages' }), { groups: [] });
  assert.equal(calls, 2, 'retry must succeed, not fail after two 429-limited attempts');
  assert.equal(sleeps.reduce((a, b) => a + b, 0), 1500);
  assert.ok(statuses.some(x => x.kind === 'rate-limit' && x.remainingMs === 1500));
});

test('rate-limit message alone defaults to a minute cooldown, not 30 seconds', () => {
  const verdict = classifyApiError(429, 'Resource has been exhausted (e.g. check quota).');
  assert.deepEqual(verdict, { kind: 'rate-limit', retry: true, cooldownMs: 65_000 });
  const seconds = new Response('', { status: 429, headers: { 'retry-after': '12' } });
  assert.equal(classifyApiError(429, 'Resource has been exhausted', seconds).cooldownMs, 12_000);
  assert.equal(classifyApiError(429, 'Please retry in 0.7s').cooldownMs, 1000);
});

test('daily quota violation exits immediately with an actionable error instead of waiting', async () => {
  let calls = 0;
  let waitMs = 0;
  const client = new GeminiClient('same-key', {
    fetchImpl: async () => {
      calls++;
      return jsonResponse({ error: {
        status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded',
        details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
            description: 'Daily quota' }] }]
      } }, 429);
    },
    sleepImpl: async ms => { waitMs += ms; }
  });
  await assert.rejects(client.generateJson({ prompt: 'study' }),
    /DAILY request quota exhausted.*Waiting one minute will not reset/);
  assert.equal(calls, 1);
  assert.equal(waitMs, 0);
});

test('HTTP 403 quota is classified before generic authentication, while actual bad keys remain auth', () => {
  assert.equal(classifyApiError(403, 'quota exceeded per minute').kind, 'rate-limit');
  assert.equal(classifyApiError(403, 'insufficient permissions').kind, 'auth');
  assert.equal(classifyApiError(400, 'API_KEY_INVALID').kind, 'auth');
});

test('multiple concurrent jobs wait on one client and resume with staggered requests', async () => {
  let now = 20_000;
  const callTimes = [];
  const events = [];
  let calls = 0;
  const client = new GeminiClient('test-key', {
    nowImpl: () => now,
    sleepImpl: async ms => { now += ms; },
    onRetry: item => events.push(item),
    fetchImpl: async () => {
      calls++;
      callTimes.push(now);
      if (calls <= 2) return jsonResponse({ error: {
        status: 'RESOURCE_EXHAUSTED', message: 'Please retry in 4s.'
      } }, 429);
      return jsonResponse({ candidates: [{ content: { parts: [{ text: '{"cards":[]}' }] } }] });
    }
  });
  const results = await Promise.all([
    client.generateJson({ prompt: 'page 40' }),
    client.generateJson({ prompt: 'page 52' }),
    client.generateJson({ prompt: 'page 55' })
  ]);
  assert.equal(results.length, 3);
  assert.equal(calls, 5);
  assert.ok(callTimes.slice(3).every(t => t >= 24_000), 'requests after a cooldown should wait');
  assert.ok(new Set(callTimes.slice(3)).size > 1, 'resumed workers should not all fire simultaneously');
  assert.ok(events.length >= 1);
});

test('permanent minute limit stops after bounded retries with explanatory message', async () => {
  let now = 50_000;
  let calls = 0;
  const client = new GeminiClient('test-key', {
    nowImpl: () => now,
    sleepImpl: async ms => { now += ms; },
    fetchImpl: async () => {
      calls++;
      return jsonResponse({ error: { status: 'RESOURCE_EXHAUSTED', message: 'Please retry in 1s.' } }, 429);
    }
  });
  await assert.rejects(client.generateJson({ prompt: 'summarize' }),
    /minute rate limit is still exceeded.*Automatic retries stopped/);
  assert.equal(calls, 9);
});

test('a malformed HTTP 400 payload keeps JSON fallback instead of entering quota wait', async () => {
  let count = 0;
  const client = new GeminiClient('key', {
    fetchImpl: async (_url, init) => {
      count++;
      if (count === 1) return jsonResponse({ error: { message: 'Unknown field responseMimeType' } }, 400);
      assert.equal(JSON.parse(init.body).generationConfig, undefined);
      return jsonResponse({ candidates: [{ content: { parts: [{ text: '{"cards":[]}' }] } }] });
    },
    sleepImpl: async () => { throw new Error('Bad-request fallback must not sleep'); }
  });
  assert.deepEqual(await client.generateJson({ prompt: 'a' }), { cards: [] });
  assert.equal(count, 2);
});

test('application informs the user of automatic cooldown without resetting progress', async () => {
  const app = await readFile(new URL('../slidesToAnki/app.js', import.meta.url), 'utf8');
  assert.match(app, /new GeminiClient\(apiKeys\(\), \{\s*onRetry:/);
  assert.match(app, /s before retrying automatically/);
  assert.match(app, /completed work are preserved/);
});
