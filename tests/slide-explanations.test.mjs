import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSlideExplanationPrompt,
  normalizeSlideExplanation,
  normalizeSlideExplanations
} from '../slidesToAnki/lib/anki-utils.js';

test('slide explanation prompt asks for faithful, simple but detailed visual teaching', () => {
  const prompt = buildSlideExplanationPrompt({ pageNumber: 2, pageCount: 9, language: 'German' });
  assert.match(prompt, /simple but detailed/i);
  assert.match(prompt, /formula.*diagram|diagram.*formula/i);
  assert.match(prompt, /instead of guessing/i);
  assert.match(prompt, /Write in German/);
  assert.match(prompt, /slide 2 of 9/);
  assert.match(prompt, /JSON only/);
});

test('slide explanations normalize optional details and preserve one-based page mapping', () => {
  const slides = normalizeSlideExplanations({ slides: [
    { title: '  ', explanation: '  Main   explanation. ', key_points: [' first ', '', 'second'], terms: [{ term: ' X ', definition: ' meaning ' }, { term: '', meaning: 'ignored' }] },
    { title: 'Second', summary: 'Short note' }
  ] }, 2);
  assert.deepEqual(slides, [
    { pageNumber: 1, title: 'Slide 1', explanation: 'Main explanation.', keyPoints: ['first', 'second'], terms: [{ term: 'X', meaning: 'meaning' }] },
    { pageNumber: 2, title: 'Second', explanation: 'Short note', keyPoints: [], terms: [] }
  ]);
});

test('slide explanation validation rejects missing, malformed, or incomplete model output', () => {
  assert.throws(() => normalizeSlideExplanation({ title: 'No body' }, 3), /no explanation for slide 3/i);
  assert.throws(() => normalizeSlideExplanations({ slides: [{ explanation: 'one' }] }, 2), /expected 2 slide explanations/i);
  assert.throws(() => normalizeSlideExplanations({ nope: [] }, 1), /invalid slide explanation payload/i);
});

test('long model lists are bounded to keep an explanation page readable', () => {
  const explanation = normalizeSlideExplanation({
    explanation: 'A complete explanation.',
    keyPoints: Array.from({ length: 20 }, (_, i) => `point ${i}`),
    terms: Array.from({ length: 20 }, (_, i) => ({ term: `term ${i}`, meaning: `meaning ${i}` }))
  }, 1);
  assert.equal(explanation.keyPoints.length, 8);
  assert.equal(explanation.terms.length, 8);
});
