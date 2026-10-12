import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE,
  loadSettings,
  normalizeSettings,
  saveSettings
} from '../slidesToAnki/lib/settings.js';

function fakeStorage() {
  const data = new Map();
  return {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: key => { data.delete(key); }
  };
}

test('restores the original default selections when no preferences are saved', () => {
  assert.equal(loadSettings(fakeStorage()), null);
  assert.deepEqual(DEFAULT_SETTINGS, {
    density: 'compact',
    cardMode: 'topics',
    strategy: 'direct',
    language: 'auto',
    includeImages: true,
    maxSourceImages: 'all',
    activeInput: 'pdf',
    model: 'gemini-2.5-flash'
  });
});

test('saves and restores all deck selections across simulated page reloads', () => {
  const storage = fakeStorage();
  const changed = {
    density: 'detailed',
    cardMode: 'questions',
    strategy: 'images',
    language: 'German',
    includeImages: false,
    maxSourceImages: '3',
    activeInput: 'slides',
    model: 'gemini-2.5-pro'
  };
  assert.equal(saveSettings(storage, changed), true);
  assert.deepEqual(loadSettings(storage), changed);
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem(SETTINGS_STORAGE))).sort(), Object.keys(DEFAULT_SETTINGS).sort());
});

test('corrupted or invalid values never break startup or override supported defaults', () => {
  const storage = fakeStorage();
  storage.setItem(SETTINGS_STORAGE, '{invalid');
  assert.equal(loadSettings(storage), null);
  storage.setItem(SETTINGS_STORAGE, JSON.stringify({
    strategy: 'nonexistent', includeImages: 'yes', activeInput: '../escape',
    model: 'https://example.com', apiKeys: 'secret'
  }));
  assert.deepEqual(loadSettings(storage), DEFAULT_SETTINGS);
  assert.equal(normalizeSettings({ language: 'English', maxSourceImages: '2' }).language, 'English');
  assert.equal(loadSettings(storage).apiKeys, undefined);
});

test('blocked storage silently disables persistence, not the app', () => {
  const storage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(loadSettings(storage), null);
  assert.equal(saveSettings(storage, DEFAULT_SETTINGS), false);
});

test('UI wires all settings to autosave and reload restore, without persisting input content', async () => {
  const app = await readFile(new URL('../slidesToAnki/app.js', import.meta.url), 'utf8');
  assert.match(app, /const savedSettings = loadSettings\(localStorage\)/);
  assert.match(app, /restoreSettings\(savedSettings\)/);
  assert.match(app, /saveSettings\(localStorage, captureSettings\(\)\)/);
  assert.match(app, /ui\.density, ui\.cardMode, ui\.strategy, ui\.language, ui\.includeImages, ui\.maxSourceImages/);
  assert.match(app, /ui\.model\.addEventListener\('change'/);
  assert.match(app, /ui\.rememberKeys\.addEventListener\('change', \(\) => saveKeys\(\)\)/);
  assert.match(app, /if \(ui\.rememberKeys\.checked\) saveKeys\(false\)/);
  assert.doesNotMatch(app, /runGeneration\(\)/);
});
