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
- **Original slide cards (legacy)** reproduces the pre-redesign Anki note structure exactly: `Order`, `Front`, `Back`, `BackContent`, and `Text`. The card front is the AI grouping title, and the back shows one or more original slide images followed by a single teaching-style explanation. **The full extracted PDF text is stored only in `Text` for searching in Anki's Browse window; the card templates never display it.** The original Include slide text checkbox defaults to on.
- Legacy mode restores original options: normal/detailed grouping, slide-by-slide annotations (optional; replacing group explanation), image compression (on by default), auto-cropping with 15px border padding (off by default), 1800px maximum image resolution, 500 KB/slide compression target and 10 parallel explanations by default. Each setting persists across reloads.
- Gemini groups the **entire PDF first**, not fixed batches. It may omit purely administrative slides and intermediate incremental reveals, just as the original did. If whole-PDF analysis fails, it tries a full-document text grouping, then overlapping eight-page visual windows as a fallback. Each final group is rendered as one card, even when retained slide pages are not consecutive.
- Unlike Anki source fields, images are embedded as real .apkg media files and always appear on the original legacy cards. On scanned PDFs without a selectable text layer, `Text` may be empty; the source images and group explanation are still present.
- Lecture mode and the usual question/topic cards are independent. Card style persists across reloads without changing the existing default.

- Multiple Gemini API keys can be entered (one per line, comma-separated, or pasted as `GEMINI_API_KEY=...`). Rejected/expired API keys (including Google's HTTP 400 `API_KEY_INVALID`) are skipped in favor of the next key, while temporary quota/overload errors use key rotation.
- **Check keys** verifies each key with both Gemini's `models.list` GET and a minimal `generateContent` POST using the selected model (`ping`, maximum eight output tokens). This matches the meaningful SDK test used in `translateLangs` and requires no PDF upload. The result displays both HTTP statuses, error categories, model and a short SHA-256 fingerprint of the actual key bytes sent (never the key itself). You can compare that fingerprint against `hashlib.sha256(key.encode()).hexdigest()[:16]` in Python, using the exact working key, without revealing credentials.
- If the same unrestricted key works in `translateLangs` but fails in the browser, do **not** assume it is invalid or blame application restrictions. Compare the SHA-256 fingerprints and the GET/POST results, then inspect the browser Network panel for the actual request/response. The `translateLangs` environment and StudyTools browser storage are independent; the tests verify the exact bytes each client sends.
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
