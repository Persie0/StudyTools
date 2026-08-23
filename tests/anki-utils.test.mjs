import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPdfCardPrompt,
  cardBackHtml,
  normalizeCards,
  normalizePages,
  safeDeckName,
  stableNumericId
} from '../slidesToAnki/lib/anki-utils.js';

test('card normalization accepts AI aliases, clamps pages and removes duplicates', () => {
  const cards = normalizeCards({ cards: [
    { question: ' Q? ', answer: ' A ', source_pages: [3, 1, 3, 0, 99], topics: ['Core topic', 'Core topic'] },
    { front: 'Q?', back: 'A', pages: [1] },
    { front: '', back: 'invalid' }
  ] }, 5);
  assert.deepEqual(cards, [{ front: 'Q?', back: 'A', pages: [1, 3], tags: ['Core_topic'] }]);
  assert.deepEqual(normalizePages(['2', 1, 2, -1], 3), [1, 2]);
});

test('PDF prompt explicitly requires visual reasoning and source pages', () => {
  const prompt = buildPdfCardPrompt({ pageCount: 10, density: 'detailed' });
  assert.match(prompt, /diagrams, plots, tables, equations/i);
  assert.match(prompt, /source page numbers/i);
  assert.match(prompt, /JSON only/i);
});

test('Anki back references packaged media files, not data URLs', () => {
  const html = cardBackHtml({ back: '<unsafe>', pages: [2] }, ['page_0002.jpg']);
  assert.match(html, /&lt;unsafe&gt;/);
  assert.match(html, /src="page_0002\.jpg"/);
  assert.doesNotMatch(html, /data:image/);
});

test('deck helpers are deterministic and sanitize file names', () => {
  assert.equal(safeDeckName('Lecture: 01?.pdf'), 'Lecture- 01-');
  assert.equal(stableNumericId('same'), stableNumericId('same'));
  assert.notEqual(stableNumericId('same'), stableNumericId('different'));
});
