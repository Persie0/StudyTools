# StudyTools

Static, browser-first utilities for PDFs and Anki decks.

## AI PDF → Anki

`slidesToAnki/gemini-anki.html` is the primary AI workflow.

- **Gemini is the default AI provider and default for every AI step.**
- Preferred model: `gemini-3.7-flash`.
- The model selector dynamically calls Gemini `models.list`, keeps every model that exposes `generateContent`, and sorts models so the recommended/free-tier/multimodal PDF models appear first.
- PDF strategy defaults to **Auto**:
  1. native PDF input when the chosen model supports it; large/long PDFs are split into 40-page PDF chunks so visual document understanding is preserved without overflowing one response;
  2. rendered page images for visual-model or per-chunk fallback;
  3. extracted text only as a last fallback.
- Generated cards include source page numbers.
- Cited PDF pages can be embedded as real `.apkg` media files.
- Multiple Gemini API keys can be entered (one per line) and rotate on temporary quota/overload errors.
- API keys are sent in the `x-goog-api-key` header rather than being placed in request URLs.
- Saving keys is **opt-in**. By default they remain only in the current browser tab.

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
