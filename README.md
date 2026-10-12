# StudyTools

Static, browser-first utilities for PDFs and Anki decks.

## AI PDF → Anki

`slidesToAnki/gemini-anki.html` is the primary AI workflow.

- **Gemini is the default AI provider and default for every AI step.**
- Preferred model: `gemini-2.5-flash` (the original PDF-to-Anki default).
- The model selector dynamically calls Gemini `models.list`, keeps every model that exposes `generateContent`, and sorts models so the recommended/free-tier/multimodal PDF models appear first.
- PDF strategy defaults to **Direct PDF** (the original "File" input selection): native PDF input where supported; large/long PDFs are split into 40-page PDF chunks, with a rendered-page fallback for failed chunks. **Auto**, rendered-page, and text-only processing remain available.
- Other restored defaults: **Compact** card density (closest to original non-detailed grouping), **Topic explanations**, **Detect from source** language, embedded source pages, and **All cited** pages per card.
- Generated cards include source page numbers.
- Cited PDF pages can be embedded as real `.apkg` media files.
- Multiple Gemini API keys can be entered (one per line, comma-separated, or pasted as `GEMINI_API_KEY=...`). Rejected/expired API keys (including Google's HTTP 400 `API_KEY_INVALID`) are skipped in favor of the next key, while temporary quota/overload errors use key rotation.
- **Check keys** verifies each key independently using Gemini's `models.list` endpoint without sending PDFs or prompts. It reports only key numbers and result codes, never the key values. A successful key check verifies authentication, not model-specific generation quota.
- If a previously working key now returns HTTP 400, inspect its status in [Google AI Studio](https://aistudio.google.com/app/apikey). In 2026, Google discontinued unrestricted legacy Standard keys; use a current Gemini authorization key or a supported Gemini-API-restricted key. The `translateLangs` GitHub Actions `GEMINI_API_KEY` secret is separate from the keys saved in this browser.
- API keys are sent in the `x-goog-api-key` header rather than being placed in request URLs.
- All deck selections (model, density, card style, PDF reading mode, language, images/card, source images and active tab) automatically persist in browser localStorage and are restored on reload. Files, pasted text and JSON are not persisted.
- Saving keys is **opt-in**. By default they remain only in the current browser tab. Turning on **Remember on this device** now saves the key immediately and updates storage as you edit it; turning it off removes saved keys.

### Inputs

The same UI supports:

- **PDF** → AI-generated deck
- **Text** → AI-generated deck
- **JSON** → deterministic deck, no API key required
- **Slide explanations** → upload a slide PDF and download a study PDF with each original slide followed by a simple, detailed explanation. Slide images are sent directly to Gemini; output PDF assembly happens locally.

Legacy topic and JSON URLs redirect into the unified converter so model and API behavior cannot drift between separate implementations.

## Other tools

- `pdfSplitter/` — split PDFs using document outlines.
- `pdfPageStripper/` — remove incremental presentation pages.
- `slidesToAnki/slidesanki.html` — non-AI slide-image Anki conversion.

## Privacy

There is no StudyTools application backend. Local-only PDF utilities stay in the browser. AI generation is different: when you click Generate, the selected PDF/text/image content is sent **directly from the browser to the Google Gemini API**. The landing page and converter state this explicitly.

## Development and tests

Requires Node 20+ only for tests; the application itself remains static HTML/CSS/JS.

```bash
npm test
```

The suite covers Gemini model discovery and request handling, Anki generation helpers, slide explanation prompts and validation, plus smoke regression checks for the splitter, page stripper, non-AI Slides → Anki, and all converter modes.

An optional live Gemini smoke test runs when `GEMINI_API_KEY` is available:

```bash
GEMINI_API_KEY=... npm run test:live
```

GitHub Actions uses the same secret name. Repository secrets cannot be read or copied by application code; add `GEMINI_API_KEY` to this repository if you want the live CI test to run.

## Architecture

- `slidesToAnki/app.js` — UI + PDF pipeline + `.apkg` assembly
- `slidesToAnki/lib/gemini.js` — Gemini model discovery, ranking, calls, multi-key retry logic
- `slidesToAnki/lib/anki-utils.js` — prompts, AI-output normalization, escaping, Anki helpers
- `tests/` — Node test suite

See [`AUDIT.md`](AUDIT.md) for the 2026 audit and remaining risks.
