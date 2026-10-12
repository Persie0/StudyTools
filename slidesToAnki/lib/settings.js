// Only non-sensitive deck options are persisted here. PDFs, text, JSON and API
// keys are deliberately excluded (API keys have their own opt-in storage).
export const SETTINGS_STORAGE = 'studytoolsAnkiSettingsV1';

const OPTIONS = {
  density: ['compact', 'balanced', 'detailed'],
  cardMode: ['questions', 'topics', 'lecture'],
  strategy: ['auto', 'direct', 'images', 'text'],
  language: ['auto', 'English', 'German'],
  maxSourceImages: ['1', '2', '3', 'all'],
  activeInput: ['pdf', 'text', 'json', 'slides']
};

export const DEFAULT_SETTINGS = Object.freeze({
  density: 'compact',
  cardMode: 'topics',
  strategy: 'direct',
  language: 'auto',
  includeImages: true,
  maxSourceImages: 'all',
  legacyIncludeText: true,
  legacyDetailedGrouping: false,
  legacySlideBySlide: false,
  legacyCompressImages: true,
  legacyAutoCrop: false,
  legacyMaxResolution: 1800,
  legacyMaxKB: 500,
  activeInput: 'pdf',
  model: 'gemini-2.5-flash'
});

export function normalizeSettings(value) {
  const candidate = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = { ...DEFAULT_SETTINGS };
  for (const [key, allowed] of Object.entries(OPTIONS)) {
    if (allowed.includes(candidate[key])) result[key] = candidate[key];
  }
  if (typeof candidate.includeImages === 'boolean') result.includeImages = candidate.includeImages;
  for (const setting of ['legacyIncludeText', 'legacyDetailedGrouping', 'legacySlideBySlide', 'legacyCompressImages', 'legacyAutoCrop']) {
    if (typeof candidate[setting] === 'boolean') result[setting] = candidate[setting];
  }
  for (const [key, min, max] of [['legacyMaxResolution', 300, 4000], ['legacyMaxKB', 50, 10000]]) {
    if (Number.isInteger(candidate[key]) && candidate[key] >= min && candidate[key] <= max) {
      result[key] = candidate[key];
    }
  }
  if (typeof candidate.model === 'string' && /^gemini-[a-z0-9][a-z0-9._-]*$/i.test(candidate.model)) {
    result.model = candidate.model;
  }
  return result;
}

export function loadSettings(storage) {
  try {
    const raw = storage?.getItem(SETTINGS_STORAGE);
    return raw ? normalizeSettings(JSON.parse(raw)) : null;
  } catch (_) {
    // Bad/legacy data or blocked localStorage must not prevent app startup.
    return null;
  }
}

export function saveSettings(storage, settings) {
  try {
    storage?.setItem(SETTINGS_STORAGE, JSON.stringify(normalizeSettings(settings)));
    return true;
  } catch (_) {
    // The converter must remain usable when persistent storage is disabled.
    return false;
  }
}
