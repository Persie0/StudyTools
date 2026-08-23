export const DEFAULT_MODEL = 'gemini-3.7-flash';

export const FALLBACK_MODELS = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.1-pro-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite'
];

const FREE_TIER_MODELS = new Set([
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite'
]);

const KNOWN_PDF_MODELS = new Set([
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite'
]);

const NON_TEXT_SPECIALIST_RE = /(embedding|aqa|imagen|veo|tts|live|image(?:-|$)|robotics|computer-use)/i;
const DEPRECATED_RE = /(gemini-1\.|gemini-2\.0|preview-09-2025|exp(?:erimental)?)/i;

export function normalizeModelId(value) {
  return String(value || '').replace(/^models\//, '').trim();
}

export function modelMetadata(value) {
  const id = normalizeModelId(value);
  const freeTier = FREE_TIER_MODELS.has(id);
  const pdf = KNOWN_PDF_MODELS.has(id) || /^gemini-3\.(?:[5-9]|\d{2,})-flash/.test(id);
  const imageInput = pdf || /^gemini-(?:2\.5|3\.)/.test(id) && !/tts|live|image$|image-/.test(id);
  const stable = !/preview|exp|experimental/i.test(id);
  const specialist = NON_TEXT_SPECIALIST_RE.test(id);
  const deprecated = DEPRECATED_RE.test(id);
  return { id, freeTier, pdf, imageInput, stable, specialist, deprecated };
}

export function modelScore(model) {
  const id = normalizeModelId(model?.name || model?.id || model);
  const meta = modelMetadata(id);
  let score = 0;
  if (id === DEFAULT_MODEL) score += 10000;
  if (meta.freeTier) score += 3000;
  if (meta.pdf) score += 1800;
  if (meta.imageInput) score += 900;
  if (meta.stable) score += 400;
  if (/flash/i.test(id)) score += 300;
  if (/flash-lite/i.test(id)) score += 120;
  if (/pro/i.test(id)) score += 80;
  if (meta.specialist) score -= 3500;
  if (meta.deprecated) score -= 6000;
  return score;
}

export function modelSupportsGenerateContent(model) {
  const methods = model?.supportedGenerationMethods || model?.supportedActions || [];
  if (!Array.isArray(methods) || methods.length === 0) return true;
  return methods.some(method => /generateContent|generate_content|generate/i.test(String(method)));
}

export function parseModelList(payload) {
  const models = Array.isArray(payload?.models) ? payload.models : [];
  const seen = new Set();
  return models
    .filter(modelSupportsGenerateContent)
    .map(model => ({ ...model, id: normalizeModelId(model.name || model.id) }))
    .filter(model => model.id && !seen.has(model.id) && seen.add(model.id))
    .sort((a, b) => modelScore(b) - modelScore(a) || a.id.localeCompare(b.id));
}

export function fallbackModelList() {
  return FALLBACK_MODELS.map(id => ({ name: `models/${id}`, id }));
}

export function mergeModelLists(primary = [], fallback = fallbackModelList()) {
  const map = new Map();
  [...primary, ...fallback].forEach(model => {
    const id = normalizeModelId(model?.id || model?.name || model);
    if (!id || map.has(id)) return;
    map.set(id, typeof model === 'string' ? { id, name: `models/${id}` } : { ...model, id });
  });
  return [...map.values()].sort((a, b) => modelScore(b) - modelScore(a) || a.id.localeCompare(b.id));
}

export function modelLabel(model) {
  const id = normalizeModelId(model?.id || model?.name || model);
  const meta = modelMetadata(id);
  const badges = [];
  if (id === DEFAULT_MODEL) badges.push('Recommended');
  if (meta.freeTier) badges.push('Free tier');
  if (meta.pdf) badges.push('PDF');
  else if (meta.imageInput) badges.push('Vision');
  if (meta.deprecated) badges.push('Deprecated');
  return badges.length ? `${id} — ${badges.join(' · ')}` : id;
}

export function chooseModel(models, requested = '') {
  const ids = new Set(models.map(model => normalizeModelId(model?.id || model?.name || model)));
  const normalizedRequested = normalizeModelId(requested);
  if (normalizedRequested && ids.has(normalizedRequested)) return normalizedRequested;
  if (ids.has(DEFAULT_MODEL)) return DEFAULT_MODEL;
  const preferred = models.find(model => !modelMetadata(model?.id || model?.name || model).specialist);
  return normalizeModelId(preferred?.id || preferred?.name || DEFAULT_MODEL);
}

export function extractResponseText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map(part => part?.text || '').join('\n').trim();
}

export function extractJsonValue(text) {
  if (typeof text !== 'string') return text;
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    const firstArray = trimmed.indexOf('[');
    const firstObject = trimmed.indexOf('{');
    const starts = [firstArray, firstObject].filter(index => index >= 0);
    if (!starts.length) throw new Error('Gemini returned no JSON payload.');
    const start = Math.min(...starts);
    const end = Math.max(trimmed.lastIndexOf(']'), trimmed.lastIndexOf('}'));
    if (end < start) throw new Error('Gemini returned malformed JSON.');
    return JSON.parse(trimmed.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1'));
  }
}

function retrySeconds(response, message) {
  const header = response?.headers?.get?.('retry-after');
  if (header && Number.isFinite(Number(header))) return Math.max(1, Number(header));
  const match = String(message || '').match(/retry(?:\s+in|\s+after)?\s*([\d.]+)\s*s/i);
  return match ? Math.max(1, Number(match[1])) : null;
}

export function classifyApiError(status, message = '', response = null) {
  const text = String(message || '');
  if (status === 401 || status === 403) return { kind: 'auth', retry: false, cooldownMs: 24 * 60 * 60 * 1000 };
  if (status === 429 || /quota|rate limit|too many requests/i.test(text)) {
    return { kind: 'rate-limit', retry: true, cooldownMs: (retrySeconds(response, text) || 30) * 1000 };
  }
  if (status === 503 || status === 504 || /overloaded|temporarily unavailable|timeout/i.test(text)) {
    return { kind: 'overloaded', retry: true, cooldownMs: 15000 };
  }
  if (status === 400) return { kind: 'bad-request', retry: false, cooldownMs: 0 };
  return { kind: 'api', retry: status >= 500, cooldownMs: status >= 500 ? 5000 : 0 };
}

export class GeminiClient {
  constructor(apiKeys, { fetchImpl = globalThis.fetch, sleepImpl = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    this.fetch = fetchImpl;
    this.sleep = sleepImpl;
    this.keys = String(apiKeys || '')
      .split(/\r?\n/)
      .map(key => key.trim())
      .filter(Boolean)
      .map(key => ({ key, availableAt: 0, disabled: false }));
    if (!this.keys.length) throw new Error('Add at least one Gemini API key.');
    this.cursor = 0;
  }

  async listModels() {
    let pageToken = '';
    const all = [];
    do {
      const suffix = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
      const response = await this.#requestWithKeys(
        `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000${suffix}`,
        { method: 'GET' },
        { maxRounds: 1 }
      );
      const payload = await response.json();
      all.push(...(payload.models || []));
      pageToken = payload.nextPageToken || '';
    } while (pageToken);
    return parseModelList({ models: all });
  }

  async generate({ model = DEFAULT_MODEL, prompt, pdfBase64 = null, images = [], json = true }) {
    const id = normalizeModelId(model) || DEFAULT_MODEL;
    const parts = [{ text: String(prompt || '') }];
    if (pdfBase64) {
      parts.push({ inlineData: { mimeType: 'application/pdf', data: pdfBase64 } });
    }
    for (const image of images || []) {
      if (!image?.data) continue;
      parts.push({ inlineData: { mimeType: image.mimeType || 'image/jpeg', data: image.data } });
    }

    const body = { contents: [{ role: 'user', parts }] };
    if (json) body.generationConfig = { responseMimeType: 'application/json' };

    let response = await this.#requestWithKeys(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(id)}:generateContent`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      { allowBadRequestReturn: true }
    );

    if (response.status === 400 && body.generationConfig) {
      delete body.generationConfig;
      response = await this.#requestWithKeys(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(id)}:generateContent`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      );
    } else if (!response.ok) {
      await this.#throwResponseError(response);
    }

    if (!response.ok) await this.#throwResponseError(response);
    const payload = await response.json();
    const text = extractResponseText(payload);
    if (!text) {
      const reason = payload?.candidates?.[0]?.finishReason || payload?.promptFeedback?.blockReason || 'empty response';
      throw new Error(`Gemini returned no text (${reason}).`);
    }
    return text;
  }

  async generateJson(options) {
    return extractJsonValue(await this.generate({ ...options, json: true }));
  }

  async #throwResponseError(response) {
    let message = `HTTP ${response.status}`;
    try {
      const raw = await response.text();
      try {
        const parsed = JSON.parse(raw);
        message = parsed?.error?.message || parsed?.message || raw || message;
      } catch (_) {
        message = raw || message;
      }
    } catch (_) {}
    throw new Error(`Gemini API error: ${message}`);
  }

  async #requestWithKeys(url, init, { maxRounds = 2, allowBadRequestReturn = false } = {}) {
    const maxAttempts = Math.max(this.keys.length * maxRounds, 2);
    let lastError = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let keyEntry = this.#nextAvailableKey();
      if (!keyEntry) {
        const active = this.keys.filter(entry => !entry.disabled);
        if (!active.length) throw new Error('All Gemini API keys were rejected.');
        const waitMs = Math.max(250, Math.min(...active.map(entry => entry.availableAt)) - Date.now());
        await this.sleep(waitMs);
        keyEntry = this.#nextAvailableKey();
        if (!keyEntry) continue;
      }

      const headers = { ...(init.headers || {}), 'x-goog-api-key': keyEntry.key };
      let response;
      try {
        response = await this.fetch(url, { ...init, headers });
      } catch (error) {
        lastError = error;
        keyEntry.availableAt = Date.now() + 1000;
        continue;
      }

      if (response.ok || (allowBadRequestReturn && response.status === 400)) return response;

      let message = '';
      try {
        const clone = response.clone ? response.clone() : response;
        const raw = await clone.text();
        try { message = JSON.parse(raw)?.error?.message || raw; } catch (_) { message = raw; }
      } catch (_) {}

      const classification = classifyApiError(response.status, message, response);
      if (classification.kind === 'auth') keyEntry.disabled = true;
      else if (classification.cooldownMs) keyEntry.availableAt = Date.now() + classification.cooldownMs;

      if (!classification.retry) {
        if (allowBadRequestReturn && response.status === 400) return response;
        throw new Error(`Gemini API error: ${message || `HTTP ${response.status}`}`);
      }
      lastError = new Error(message || `HTTP ${response.status}`);
    }

    throw new Error(`Gemini request failed after retries${lastError?.message ? `: ${lastError.message}` : '.'}`);
  }

  #nextAvailableKey() {
    const now = Date.now();
    for (let offset = 0; offset < this.keys.length; offset++) {
      const index = (this.cursor + offset) % this.keys.length;
      const entry = this.keys[index];
      if (!entry.disabled && entry.availableAt <= now) {
        this.cursor = (index + 1) % this.keys.length;
        return entry;
      }
    }
    return null;
  }
}
