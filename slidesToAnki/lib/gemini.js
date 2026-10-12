// Match the original PDF-to-Anki default, rather than preferring an unverified newer model.
export const DEFAULT_MODEL = 'gemini-2.5-flash';

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

// JSON-mode models can still output single LaTeX backslashes (e.g. \( or
// \frac), which are invalid JSON escapes or silently become \f, \t or \b.
// Only normalize characters *inside* JSON strings. Never strip backslashes
// globally, since doing so corrupts equations and legitimate JSON escapes.
const LATEX_JSON_COMMANDS = new Set([
  'frac', 'fbox', 'forall', 'footnotesize',
  'beta', 'begin', 'bar', 'boldsymbol', 'mathbf', 'mathbb',
  'binom', 'big', 'bigl', 'bigr', 'bigg', 'biggl', 'biggr', 'bf',
  'theta', 'tau', 'times', 'text', 'textbf', 'textit', 'textrm',
  'tilde', 'to', 'top', 'triangle', 'tan', 'tanh',
  'rho', 'right', 'rightarrow', 'rangle', 'rm', 'ref',
  'nabla', 'neq', 'notin', 'not', 'nu', 'newline',
  'underbrace', 'underset', 'underline', 'uparrow',
  'vec', 'vert', 'vphantom', 'varphi',
  'dfrac', 'tfrac', 'sqrt', 'left', 'lim', 'log',
  'sum', 'int', 'prod', 'alpha', 'gamma', 'delta',
  'epsilon', 'sigma', 'pi', 'lambda', 'mu', 'omega',
  'partial', 'infty', 'cdot', 'cdots', 'ldots',
  'leq', 'geq', 'approx', 'leftarrow', 'overline',
  'mathcal', 'mathit', 'mathrm', 'mathsf',
  'bmod', 'backslash', 'breve', 'bigcup', 'bigcap', 'bfseries',
  'rceil', 'rfloor', 'rvert', 'rVert', 'rbrace', 'rightleftharpoons',
  'nexists', 'nRightarrow', 'textcolor', 'textstyle', 'tiny', 'therefore'
]);

export function repairModelJson(text) {
  let repaired = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (!inString) {
      if (char === '"') inString = true;
      // Only remove structural trailing commas, never commas inside text.
      if (char === ',') {
        let next = i + 1;
        while (next < text.length && /\s/.test(text[next])) next++;
        if (text[next] === '}' || text[next] === ']') continue;
      }
      repaired += char;
      continue;
    }

    if (char === '"') {
      inString = false;
      repaired += char;
    } else if (char === '\\') {
      const next = text[i + 1];
      const command = /^[a-zA-Z]+/.exec(text.slice(i + 1))?.[0] || '';
      const latex = LATEX_JSON_COMMANDS.has(command);
      const validEscape = next === 'u'
        ? /^[\da-fA-F]{4}$/.test(text.slice(i + 2, i + 6))
        : next !== undefined && '"\\/bfnrt'.includes(next);
      if (!validEscape || latex) {
        // Escaping the slash itself preserves the literal LaTeX command.
        repaired += '\\\\';
      } else {
        repaired += '\\' + next;
        i++;
      }
    } else if (char === '\n') {
      repaired += '\\n';
    } else if (char === '\r') {
      repaired += '\\r';
    } else if (char === '\t') {
      repaired += '\\t';
    } else {
      repaired += char;
    }
  }
  return repaired;
}

export function extractJsonValue(text) {
  if (typeof text !== 'string') return text;
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const firstArray = trimmed.indexOf('[');
  const firstObject = trimmed.indexOf('{');
  const starts = [firstArray, firstObject].filter(index => index >= 0);
  if (!starts.length) throw new Error('Gemini returned no JSON payload.');
  const start = Math.min(...starts);
  const end = Math.max(trimmed.lastIndexOf(']'), trimmed.lastIndexOf('}'));
  if (end < start) throw new Error('Gemini returned incomplete JSON. Please retry generation.');
  const candidate = trimmed.slice(start, end + 1);
  try {
    // Repairing before parsing also protects \frac and \theta, which would
    // otherwise be accepted as JSON control-character escapes.
    return JSON.parse(repairModelJson(candidate));
  } catch (_) {
    throw new Error('Gemini returned malformed JSON that could not be repaired. Please retry generation or choose another model.');
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
  // Google reports API_KEY_INVALID as HTTP 400, not HTTP 401. It must
  // disable the rejected key and allow the next key to be tried.
  if (/API_KEY_INVALID|API key not valid|invalid API key|API key was reported as leaked/i.test(text)) {
    return { kind: 'auth', retry: false, cooldownMs: 24 * 60 * 60 * 1000 };
  }
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

// Accept plain keys, newline/CSV lists, and copies from .env files; never
// keep accidental quotes, BOM, duplicate keys, or comment lines.
export function parseApiKeys(input) {
  const unique = new Set();
  for (const raw of String(input || '').replace(/^\uFEFF/, '').split(/[\r\n,;]+/)) {
    let key = raw.trim();
    if (!key || key.startsWith('#')) continue;
    key = key.replace(/^(?:export\s+)?(?:GEMINI_API_KEY|GOOGLE_API_KEY)\s*=\s*/i, '').trim();
    if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
      key = key.slice(1, -1).trim();
    }
    if (key) unique.add(key);
  }
  return [...unique];
}

async function responseError(response) {
  let message = `HTTP ${response.status}`;
  let reason = '';
  try {
    const raw = await (response.clone ? response.clone() : response).text();
    try {
      const data = JSON.parse(raw);
      message = String(data?.error?.message || data?.message || message);
      const details = data?.error?.details;
      reason = Array.isArray(details) ?
        String(details.find(item => item?.reason)?.reason || '') : '';
    } catch (_) {
      message = raw || message;
    }
  } catch (_) {}
  return { message, reason };
}

// Short one-way fingerprint to compare the actual browser key bytes with a
// local Python key without ever printing or transmitting the credential.
async function fingerprintKey(key) {
  try {
    const bytes = new TextEncoder().encode(key);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest).slice(0, 8), x => x.toString(16).padStart(2, '0')).join('');
  } catch (_) {
    return null;
  }
}

export class GeminiClient {
  constructor(apiKeys, { fetchImpl = globalThis.fetch, sleepImpl = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    // Native Window.fetch requires a Window receiver. Calling a stored unbound
    // reference as this.fetch(...) otherwise throws TypeError: Illegal invocation.
    this.fetch = fetchImpl.bind(globalThis);
    this.sleep = sleepImpl;
    this.keys = parseApiKeys(apiKeys)
      .map((key, index) => ({ key, index: index + 1, availableAt: 0, disabled: false }));
    if (!this.keys.length) throw new Error('Add at least one Gemini API key.');
    this.cursor = 0;
  }

  // Compare read and generation requests using exactly the transport used
  // by StudyTools. Unlike a model-list check alone, this mirrors the minimal
  // google-genai SDK ping used by translateLangs.
  async checkKeys({ model = DEFAULT_MODEL } = {}) {
    const modelId = normalizeModelId(model) || DEFAULT_MODEL;
    const results = [];
    const probe = async (url, init) => {
      try {
        const response = await this.fetch(url, {
          ...init,
          cache: 'no-store',
          credentials: 'omit'
        });
        if (response.ok) return { ok: true, status: response.status, kind: 'valid', reason: '', message: 'Accepted' };
        const { message, reason } = await responseError(response);
        const { kind } = classifyApiError(response.status, `${reason} ${message}`, response);
        return { ok: false, status: response.status, kind, reason, message };
      } catch (error) {
        return { ok: false, status: 0, kind: 'network', reason: '', message: String(error?.message || error) };
      }
    };
    for (const entry of this.keys) {
      const headers = { 'x-goog-api-key': entry.key };
      const list = await probe(
        'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
        { method: 'GET', headers }
      );
      const generation = await probe(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
            generationConfig: { maxOutputTokens: 8 }
          })
        }
      );
      // Never include the key in the diagnostic output.
      results.push({
        index: entry.index,
        fingerprint: await fingerprintKey(entry.key),
        model: modelId,
        list,
        generation,
        ok: generation.ok,
        status: generation.status,
        kind: generation.kind,
        reason: generation.reason,
        message: generation.message
      });
    }
    return results;
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
    const { message } = await responseError(response);
    throw new Error(`Gemini API error: ${message}`);
  }

  async #requestWithKeys(url, init, { maxRounds = 2, allowBadRequestReturn = false } = {}) {
    const maxAttempts = Math.max(this.keys.length * maxRounds, 2);
    let lastError = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let keyEntry = this.#nextAvailableKey();
      if (!keyEntry) {
        const active = this.keys.filter(entry => !entry.disabled);
        if (!active.length) {
          throw new Error(lastError?.message || 'All Gemini API keys were rejected. Check the keys in Google AI Studio.');
        }
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
        // A JavaScript invocation bug is not a transient Google API failure.
        if (/illegal invocation/i.test(String(error?.message || ''))) throw error;
        lastError = error;
        keyEntry.availableAt = Date.now() + 1000;
        continue;
      }

      if (response.ok) return response;
      const { message, reason } = await responseError(response);
      const classification = classifyApiError(response.status, `${reason} ${message}`, response);
      if (classification.kind === 'auth') {
        keyEntry.disabled = true;
        lastError = new Error(
          `Gemini rejected API key #${keyEntry.index} (HTTP ${response.status}${reason ? ` ${reason}` : ''}): ${message.replace(/[.!?\s]+$/, '')}. ` +
          'Compare this browser request with the working SDK request using Check keys (never share key values).'
        );
        // Unlike a malformed request, an invalid key is not a reason to retry
        // the same key without responseMimeType; try the next key instead.
        continue;
      }
      if (allowBadRequestReturn && response.status === 400) return response;
      if (classification.cooldownMs) keyEntry.availableAt = Date.now() + classification.cooldownMs;
      if (!classification.retry) throw new Error(`Gemini API error (HTTP ${response.status}): ${message}`);
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
