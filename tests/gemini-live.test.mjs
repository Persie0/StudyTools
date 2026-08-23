import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MODEL, GeminiClient } from '../slidesToAnki/lib/gemini.js';

const key = process.env.GEMINI_API_KEY || '';

test('live Gemini model discovery and structured output smoke test', { skip: !key }, async () => {
  const client = new GeminiClient(key);
  const models = await client.listModels();
  assert.ok(models.some(model => model.id === DEFAULT_MODEL), `${DEFAULT_MODEL} should be available`);
  const response = await client.generateJson({
    model: DEFAULT_MODEL,
    prompt: 'Return JSON only: {"ok": true}. Do not add any other fields.'
  });
  assert.equal(response.ok, true);
});
