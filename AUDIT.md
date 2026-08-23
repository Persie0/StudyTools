# StudyTools audit — August 2026

Scope: landing page, AI PDF/Anki workflows, JSON/Anki workflow, API configuration, export behavior, security/privacy copy, and automated testing.

## Critical / high-impact findings fixed

### 1. Provider configuration had already drifted and duplicated itself

The previous `gemini-anki.html` contained two `openrouter` entries in the same model-options object after patch-script changes. In JavaScript, the later property silently wins, making the first list dead configuration and making future edits unreliable.

**Fix:** the AI implementation is now centralized. Gemini configuration lives in `slidesToAnki/lib/gemini.js`; topic and JSON entry points reuse/redirect to the same converter instead of maintaining copies.

### 2. A removed Gemini model was still a default

`jsonToAnki` still defaulted to `gemini-2.0-flash-exp`, despite Gemini 2.0 Flash being shut down in 2026.

**Fix:** all AI flows now default to `gemini-3.7-flash`, with model discovery at runtime and a curated fallback list.

### 3. Hard-coded model lists could not satisfy “all models selectable”

Every new Gemini model required editing HTML manually.

**Fix:** the browser calls `models.list`, filters to `generateContent` capability, deduplicates, and ranks the result. Every discovered generative model remains selectable; ranking only changes display order.

### 4. PDF understanding was inconsistent and sometimes text-first

Extracted text loses diagrams, equations, arrows, spatial layout and table relationships—the content that often matters most in lecture slides.

**Fix:** Auto strategy is multimodal-first: native PDF → rendered page images → text fallback. Prompts explicitly tell Gemini to use visual evidence and return original source pages.

### 5. API keys appeared in Gemini request URLs

The old code called `...?key=${apiKey}` and logged request URLs. That can expose keys in console output, copied logs, browser/dev tooling, or intermediary logging.

**Fix:** requests use the `x-goog-api-key` header and no code logs the key or credential-bearing URL. Auth failures disable only the affected key in memory.

### 6. API keys were persisted by default

The old UI encouraged saving raw keys in `localStorage` with no opt-in boundary.

**Fix:** persistence is explicit via “Remember on this device”. The default is tab-only memory; Clear removes saved credentials.

### 7. Privacy notice was materially inaccurate for AI modes

The landing page claimed files were “never uploaded to any server”, while AI conversion uploads document content to Gemini.

**Fix:** copy now distinguishes local PDF utilities from AI generation and states that selected content goes directly from the browser to Google Gemini.

### 8. Anki media export path was fragile

The previous AI converter put base64/data-image HTML into note content and also treated `Package.writeToFile()` as if it returned an ArrayBuffer. `genanki-js` actually builds the archive and invokes `saveAs()` itself.

**Fix:** cited page images are added with `Package.addMedia()` as actual JPEG media and cards reference media filenames. Export uses `writeToFile()` for its intended download behavior.

### 9. AI output validation was ad hoc

Malformed/duplicate cards and invalid page references could enter the deck.

**Fix:** shared normalization rejects empty cards, deduplicates equivalent Q/A pairs, sanitizes tags, parses aliases, and clamps source pages to the real PDF page count.

### 10. No automated regression suite

Provider/model fixes were made through one-off patch scripts and regressions reached `main`.

**Fix:** Node tests plus GitHub Actions now cover model selection, API request safety, PDF payloads, retries, JSON parsing, card normalization, media HTML, privacy copy, and deprecated-provider/default regressions. A secret-gated live Gemini smoke test is included.

## UI / usability improvements

- One focused converter instead of multiple divergent AI pages.
- PDF is the primary tab; Text and JSON remain available.
- Model capability badges show recommended/free-tier/PDF/vision status.
- “Refresh all” discovers current models from Gemini rather than requiring a deployment.
- Better file queue, drag/drop, responsive layout, dark mode, progress state, result cards, and clearer error presentation.
- Defaults target the common lecture workflow: Balanced cards, question-answer format, Auto multimodal reading, source images on.

## Remaining risks / future work

1. **Browser memory:** inline base64 PDF requests can temporarily use significantly more RAM than the original PDF. The 50 MB API limit is enforced; very large documents should still be split first.
2. **Model capability metadata:** Gemini’s list endpoint exposes generation methods but not every modality/free-tier attribute in a machine-readable form. Known current models are annotated locally for ranking; unknown new models remain selectable but may show generic metadata.
3. **AI correctness:** source-page grounding makes review easier but does not guarantee factual correctness. Users should review cards before high-stakes study.
4. **CDN dependency availability:** the site still depends on pinned third-party browser libraries (PDF.js, SQL.js, JSZip, FileSaver, genanki-js). A future hardening pass could vendor those assets and add Subresource Integrity where practical.
5. **End-to-end browser testing:** unit/static tests cover the critical logic. A Playwright suite with a synthetic PDF would further validate actual browser rendering and `.apkg` download behavior.
6. **Multiple automatic downloads:** selecting several PDFs creates one `.apkg` download per PDF; browsers may ask users to allow multiple downloads.

## Live Gemini testing

`translateLangs` uses a repository secret named `GEMINI_API_KEY`, but GitHub intentionally does not expose secret values for reading/copying. StudyTools includes a live smoke test that automatically skips without a key. Add the same secret name to StudyTools to activate the live CI call without ever committing the credential.

## Audit notes on the remaining legacy utilities

The non-AI utilities were inspected as well. They are still usable, but they contain older code patterns that are outside the primary PDF→Anki rewrite and should be handled in a follow-up hardening pass:

- `pdfPageStripper/scripts.js` registers `initCheckboxState` and `setupDragAndDrop` twice, so handlers are duplicated on every load. Its result HTML also interpolates the local filename into `innerHTML` without escaping it. This is low exposure because filenames are local, but it is unnecessary DOM-injection risk.
- `pdfSplitter/pdf-splitter.html` reads the selected PDF twice, assumes every outline destination must be resolved through `getDestination()` even though PDF.js outlines may contain explicit destination arrays, and can create zero/negative-length chapter ranges when nested outline entries share a start page.
- `slidesToAnki/slidesanki.html` remains a large inline legacy implementation. It duplicates functionality now available in the unified converter and still uses older CDN/loading patterns. It is intentionally kept as the deterministic non-AI converter for compatibility, but should eventually be modularized and covered by browser tests.

These are documented rather than silently mixed into the AI rewrite so the main PDF→Anki change remains reviewable. The next cleanup should target the splitter/stripper algorithms with synthetic PDFs that exercise nested outlines and incremental slides.
