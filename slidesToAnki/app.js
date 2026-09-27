import {
  DEFAULT_MODEL,
  GeminiClient,
  chooseModel,
  fallbackModelList,
  mergeModelLists,
  modelLabel,
  modelMetadata,
  normalizeModelId
} from './lib/gemini.js';
import {
  buildPdfCardPrompt,
  buildSlideExplanationPrompt,
  normalizeSlideExplanations,
  buildTextCardPrompt,
  cardBackHtml,
  escapeHtml,
  normalizeCards,
  safeDeckName,
  stableNumericId
} from './lib/anki-utils.js';

const PDF_INLINE_LIMIT = 50 * 1024 * 1024;
const PDF_INLINE_SAFETY_LIMIT = 47 * 1024 * 1024;
const IMAGE_BATCH_SIZE = 6;
const PDF_CHUNK_SIZE = 40;
const DIRECT_PDF_PAGE_LIMIT = 80;
const TEXT_CHUNK_LIMIT = 48_000;
const API_KEY_STORAGE = 'studytoolsGeminiKeysV2';
const MODEL_STORAGE = 'studytoolsGeminiModelV2';

const $ = id => document.getElementById(id);
const ui = {
  apiKeys: $('api-keys'), rememberKeys: $('remember-keys'), saveKeys: $('save-keys'), clearKeys: $('clear-keys'),
  model: $('model-select'), refreshModels: $('refresh-models'), modelMeta: $('model-meta'),
  inputTabs: [...document.querySelectorAll('[data-input-tab]')], inputPanels: [...document.querySelectorAll('[data-input-panel]')],
  fileInput: $('pdf-input'), choosePdfs: $('choose-pdfs'), dropzone: $('dropzone'), fileList: $('file-list'), textInput: $('text-input'), jsonInput: $('json-input'),
  slideFiles: $('slide-pdf-input'), chooseSlidePdf: $('choose-slide-pdf'), slideDropzone: $('slide-dropzone'), slideFileList: $('slide-file-list'), explainSlides: $('explain-slides'),
  density: $('density'), cardMode: $('card-mode'), strategy: $('strategy'), language: $('language'),
  includeImages: $('include-images'), maxSourceImages: $('max-source-images'),
  generate: $('generate'), progress: $('progress'), progressFill: $('progress-fill'), status: $('status'), error: $('error'), results: $('results'),
  keyHelp: $('key-help')
};

const state = {
  files: [],
  slideFile: null,
  models: fallbackModelList(),
  activeInput: 'pdf',
  busy: false
};

let sqlReady = null;
if (typeof initSqlJs === 'function') {
  sqlReady = initSqlJs({ locateFile: filename => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${filename}` })
    .then(sql => { window.SQL = sql; return sql; });
}
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
}

function setStatus(message, percent = null) {
  ui.status.textContent = message;
  if (percent != null) {
    const safe = Math.max(0, Math.min(100, Number(percent) || 0));
    ui.progressFill.style.width = `${safe}%`;
    ui.progress.setAttribute('aria-valuenow', String(Math.round(safe)));
  }
}

function showError(error) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  ui.error.textContent = message;
  ui.error.hidden = false;
  setStatus('Generation stopped.', 0);
}

function clearError() {
  ui.error.hidden = true;
  ui.error.textContent = '';
}

function apiKeys() {
  return ui.apiKeys.value.trim();
}

function currentModel() {
  return normalizeModelId(ui.model.value || DEFAULT_MODEL);
}

function updateGenerateState() {
  if (state.busy) {
    ui.generate.disabled = true;
    ui.explainSlides.disabled = true;
    return;
  }
  const hasInput = state.activeInput === 'pdf' ? state.files.length > 0
    : state.activeInput === 'slides' ? Boolean(state.slideFile)
    : state.activeInput === 'text' ? ui.textInput.value.trim().length > 0
    : ui.jsonInput.value.trim().length > 0;
  const needsAi = state.activeInput !== 'json';
  ui.generate.disabled = !hasInput || (needsAi && !apiKeys());
  ui.generate.hidden = state.activeInput === 'slides';
  ui.explainSlides.hidden = state.activeInput !== 'slides';
  ui.explainSlides.disabled = state.busy || !hasInput || !apiKeys();
}

function renderModelOptions(requested = '') {
  const selected = chooseModel(state.models, requested || localStorage.getItem(MODEL_STORAGE) || DEFAULT_MODEL);
  ui.model.innerHTML = state.models.map(model => {
    const id = normalizeModelId(model.id || model.name);
    return `<option value="${escapeHtml(id)}">${escapeHtml(modelLabel(model))}</option>`;
  }).join('');
  ui.model.value = selected;
  if (!ui.model.value && state.models.length) ui.model.value = normalizeModelId(state.models[0].id || state.models[0].name);
  updateModelMeta();
}

function updateModelMeta() {
  const meta = modelMetadata(currentModel());
  const bits = [];
  if (currentModel() === DEFAULT_MODEL) bits.push('recommended');
  if (meta.freeTier) bits.push('free tier');
  if (meta.pdf) bits.push('direct PDF');
  else if (meta.imageInput) bits.push('image input');
  if (meta.deprecated) bits.push('legacy/deprecated');
  ui.modelMeta.textContent = bits.length ? bits.join(' · ') : 'available Gemini generateContent model';
  if (ui.strategy.value === 'direct' && !meta.pdf) ui.strategy.value = 'auto';
}

async function refreshModels() {
  if (!apiKeys()) throw new Error('Add a Gemini API key before refreshing models.');
  const requested = currentModel();
  ui.refreshModels.disabled = true;
  setStatus('Loading available Gemini models…', 2);
  try {
    const client = new GeminiClient(apiKeys());
    const discovered = await client.listModels();
    state.models = mergeModelLists(discovered);
    renderModelOptions(requested);
    setStatus(`Loaded ${discovered.length} selectable generateContent models.`, 4);
  } finally {
    ui.refreshModels.disabled = false;
  }
}

function switchInput(input) {
  state.activeInput = ['pdf', 'text', 'json', 'slides'].includes(input) ? input : 'pdf';
  for (const tab of ui.inputTabs) {
    const active = tab.dataset.inputTab === state.activeInput;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  for (const panel of ui.inputPanels) panel.hidden = panel.dataset.inputPanel !== state.activeInput;
  document.body.dataset.inputMode = state.activeInput;
  updateGenerateState();
}

function addFiles(fileList) {
  for (const file of Array.from(fileList || [])) {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) continue;
    if (!state.files.some(existing => existing.name === file.name && existing.size === file.size)) state.files.push(file);
  }
  renderFiles();
  updateGenerateState();
}

function renderFiles() {
  if (!state.files.length) {
    ui.fileList.innerHTML = '<p class="muted">No PDFs selected.</p>';
    return;
  }
  ui.fileList.innerHTML = state.files.map((file, index) => `
    <div class="file-row">
      <div><strong>${escapeHtml(file.name)}</strong><span>${(file.size / 1024 / 1024).toFixed(1)} MB</span></div>
      <button type="button" class="icon-button" data-remove-file="${index}" aria-label="Remove ${escapeHtml(file.name)}">×</button>
    </div>`).join('');
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(binary);
}

async function loadPdf(file) {
  if (!window.pdfjsLib) throw new Error('PDF.js did not load. Reload the page and try again.');
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
  return { pdf, buffer };
}

async function extractPageText(pdf, pageNumber) {
  const page = await pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  return content.items.map(item => item.str || '').join(' ').replace(/\s+/g, ' ').trim();
}

async function extractPdfText(pdf) {
  const blocks = [];
  for (let page = 1; page <= pdf.numPages; page++) {
    blocks.push(`--- PAGE ${page} ---\n${await extractPageText(pdf, page)}`);
  }
  return blocks.join('\n\n');
}

function splitTextByPages(text, maxChars = TEXT_CHUNK_LIMIT) {
  const pages = text.split(/(?=--- PAGE \d+ ---)/g).filter(Boolean);
  const chunks = [];
  let current = '';
  for (const page of pages) {
    if (current && current.length + page.length > maxChars) {
      chunks.push(current);
      current = '';
    }
    current += (current ? '\n\n' : '') + page;
  }
  if (current) chunks.push(current);
  return chunks;
}

async function canvasToJpeg(canvas, quality = 0.82) {
  const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not render page image.')), 'image/jpeg', quality));
  return new Uint8Array(await blob.arrayBuffer());
}

async function renderPdfPage(pdf, pageNumber, maxWidth = 1600) {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2, maxWidth / base.width);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d', { alpha: false });
  await page.render({ canvasContext: context, viewport }).promise;
  return canvasToJpeg(canvas);
}

function bytesToBase64(bytes) {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(binary);
}

async function generateCardsDirectPdf(client, model, file, pdf, buffer) {
  if (file.size > PDF_INLINE_LIMIT) throw new Error('This PDF is over Gemini’s 50 MB inline PDF limit.');
  const prompt = buildPdfCardPrompt({ pageCount: pdf.numPages, density: ui.density.value, language: ui.language.value, mode: ui.cardMode.value });
  const payload = await client.generateJson({ model, prompt, pdfBase64: arrayBufferToBase64(buffer) });
  return normalizeCards(payload, pdf.numPages);
}

async function generateCardsFromImages(client, model, pdf, range = {}) {
  const firstPage = Math.max(1, range.start || 1);
  const lastPage = Math.min(pdf.numPages, range.end || pdf.numPages);
  const cards = [];
  const totalBatches = Math.ceil((lastPage - firstPage + 1) / IMAGE_BATCH_SIZE);
  for (let start = firstPage, batch = 0; start <= lastPage; start += IMAGE_BATCH_SIZE, batch++) {
    const end = Math.min(lastPage, start + IMAGE_BATCH_SIZE - 1);
    setStatus(`Reading visual content from pages ${start}–${end}…`, 12 + (batch / Math.max(1, totalBatches)) * 48);
    const images = [];
    for (let page = start; page <= end; page++) {
      const bytes = await renderPdfPage(pdf, page, 1500);
      images.push({ mimeType: 'image/jpeg', data: bytesToBase64(bytes) });
    }
    const prompt = [
      buildPdfCardPrompt({ pageCount: end - start + 1, density: ui.density.value, language: ui.language.value, mode: ui.cardMode.value }),
      `The attached images correspond exactly to original PDF pages ${start} through ${end}.`,
      'Use those original page numbers in every cards[].pages value.'
    ].join('\n');
    const payload = await client.generateJson({ model, prompt, images });
    cards.push(...normalizeCards(payload, pdf.numPages));
  }
  return normalizeCards(cards, pdf.numPages);
}

async function generateCardsFromPdfChunks(client, model, pdf, buffer) {
  if (typeof PDFLib === 'undefined') return generateCardsFromImages(client, model, pdf);
  const source = await PDFLib.PDFDocument.load(buffer.slice(0));
  const cards = [];
  const totalChunks = Math.ceil(pdf.numPages / PDF_CHUNK_SIZE);
  for (let start = 1, chunkIndex = 0; start <= pdf.numPages; start += PDF_CHUNK_SIZE, chunkIndex++) {
    const end = Math.min(pdf.numPages, start + PDF_CHUNK_SIZE - 1);
    setStatus(`Preparing PDF pages ${start}–${end}…`, 10 + (chunkIndex / Math.max(1, totalChunks)) * 50);
    const chunk = await PDFLib.PDFDocument.create();
    const indices = Array.from({ length: end - start + 1 }, (_, index) => start - 1 + index);
    const copied = await chunk.copyPages(source, indices);
    copied.forEach(page => chunk.addPage(page));
    const chunkBytes = await chunk.save({ useObjectStreams: true });

    if (chunkBytes.byteLength > PDF_INLINE_SAFETY_LIMIT) {
      cards.push(...await generateCardsFromImages(client, model, pdf, { start, end }));
      continue;
    }

    const prompt = [
      buildPdfCardPrompt({ pageCount: end - start + 1, density: ui.density.value, language: ui.language.value, mode: ui.cardMode.value }),
      `This attached PDF chunk contains original document pages ${start} through ${end}.`,
      'The chunk itself starts at page 1, but cards[].pages MUST use the ORIGINAL document page numbers stated above.'
    ].join('\n');
    try {
      const payload = await client.generateJson({ model, prompt, pdfBase64: bytesToBase64(chunkBytes) });
      cards.push(...normalizeCards(payload, pdf.numPages));
    } catch (error) {
      console.warn(`Direct PDF chunk ${start}-${end} failed; retrying as rendered page images.`, error);
      cards.push(...await generateCardsFromImages(client, model, pdf, { start, end }));
    }
  }
  return normalizeCards(cards, pdf.numPages);
}

async function generateCardsFromPdfText(client, model, pdf) {
  setStatus('Extracting PDF text…', 14);
  const text = await extractPdfText(pdf);
  if (!text.replace(/--- PAGE \d+ ---/g, '').trim()) throw new Error('No selectable PDF text was found. Use Auto or Rendered pages so Gemini can read the page images.');
  const chunks = splitTextByPages(text);
  const cards = [];
  for (let i = 0; i < chunks.length; i++) {
    setStatus(`Generating from text chunk ${i + 1}/${chunks.length}…`, 22 + (i / chunks.length) * 38);
    const prompt = [
      buildTextCardPrompt({ density: ui.density.value, language: ui.language.value }),
      'The material contains --- PAGE N --- delimiters. Preserve the original page numbers in cards[].pages.',
      chunks[i]
    ].join('\n\n');
    const payload = await client.generateJson({ model, prompt });
    cards.push(...normalizeCards(payload, pdf.numPages));
  }
  return normalizeCards(cards, pdf.numPages);
}

async function generatePdfCards(client, model, file, pdf, buffer) {
  const strategy = ui.strategy.value;
  const meta = modelMetadata(model);
  if (strategy === 'text') return generateCardsFromPdfText(client, model, pdf);
  if (strategy === 'images') return generateCardsFromImages(client, model, pdf);
  if (strategy === 'direct') {
    if (!meta.pdf) throw new Error(`${model} is not known to support native PDF input. Choose Auto, Rendered pages, or another PDF-capable Gemini model.`);
    if (file.size <= PDF_INLINE_SAFETY_LIMIT && pdf.numPages <= DIRECT_PDF_PAGE_LIMIT) return generateCardsDirectPdf(client, model, file, pdf, buffer);
    return generateCardsFromPdfChunks(client, model, pdf, buffer);
  }

  if (meta.pdf) {
    try {
      if (file.size <= PDF_INLINE_SAFETY_LIMIT && pdf.numPages <= DIRECT_PDF_PAGE_LIMIT) {
        setStatus('Sending the PDF directly to Gemini for multimodal analysis…', 12);
        return await generateCardsDirectPdf(client, model, file, pdf, buffer);
      }
      return await generateCardsFromPdfChunks(client, model, pdf, buffer);
    } catch (error) {
      console.warn('Native PDF analysis failed; falling back to page images.', error);
      setStatus('Native PDF analysis failed; retrying with rendered pages…', 16);
    }
  }
  if (meta.imageInput) return generateCardsFromImages(client, model, pdf);
  return generateCardsFromPdfText(client, model, pdf);
}

async function mediaForCards(packageObject, pdf, cards, fileIndex) {
  if (!ui.includeImages.checked) return new Map();
  const maxImages = ui.maxSourceImages.value === 'all' ? Infinity : Math.max(0, Number(ui.maxSourceImages.value) || 0);
  const needed = new Set();
  for (const card of cards) for (const page of card.pages.slice(0, maxImages)) needed.add(page);
  const media = new Map();
  let done = 0;
  for (const page of [...needed].sort((a, b) => a - b)) {
    setStatus(`Embedding source page ${page} into the Anki deck…`, 68 + (done / Math.max(1, needed.size)) * 18);
    const bytes = await renderPdfPage(pdf, page, 1500);
    const name = `studytools_${fileIndex}_${String(page).padStart(4, '0')}.jpg`;
    packageObject.addMedia(bytes, name);
    media.set(page, name);
    done++;
  }
  return media;
}

function ankiModel() {
  return new Model({
    name: 'StudyTools AI v2',
    id: String(stableNumericId('studytools-ai-v2') + 1_000_000_000_000),
    flds: [{ name: 'Front' }, { name: 'Back' }, { name: 'SourcePages' }],
    req: [[0, 'all', [0]]],
    tmpls: [{
      name: 'Card 1',
      qfmt: '<div class="question">{{Front}}</div>',
      afmt: '{{FrontSide}}<hr id="answer">{{Back}}'
    }],
    css: `
      .card { font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; font-size:20px; text-align:left; color:#172033; background:#fff; max-width:900px; margin:auto; }
      .question { font-size:1.18em; font-weight:700; line-height:1.35; }
      .ai-answer { line-height:1.55; margin:12px 0; white-space:normal; }
      .source-pages { color:#667085; font-size:.72em; margin:16px 0 8px; }
      .source-slide img { width:100%; height:auto; border-radius:10px; margin:8px 0; }
      hr#answer { border:0; border-top:1px solid #d0d5dd; margin:18px 0; }
      .nightMode .card { color:#f2f4f7; background:#15171a; }
    `
  });
}

async function createDeck(cards, deckName, { pdf = null, fileIndex = 0 } = {}) {
  if (!cards.length) throw new Error('Gemini did not produce any valid flashcards. Try Detailed density or another model.');
  if (typeof Model === 'undefined' || typeof Deck === 'undefined' || typeof Package === 'undefined') throw new Error('Anki export library did not load. Reload the page and try again.');
  if (!window.SQL && sqlReady) await sqlReady;
  if (!window.SQL) throw new Error('SQL.js did not load, so the Anki package cannot be built.');

  const model = ankiModel();
  const deck = new Deck(Date.now() + fileIndex, deckName);
  const pkg = new Package();
  pkg.addDeck(deck);
  const media = pdf ? await mediaForCards(pkg, pdf, cards, fileIndex) : new Map();
  const maxImages = ui.maxSourceImages.value === 'all' ? Infinity : Math.max(0, Number(ui.maxSourceImages.value) || 0);

  for (const card of cards) {
    const mediaNames = card.pages.slice(0, maxImages).map(page => media.get(page)).filter(Boolean);
    const note = model.note([
      escapeHtml(card.front),
      cardBackHtml(card, mediaNames),
      card.pages.join(', ')
    ], card.tags);
    deck.addNote(note);
  }

  setStatus(`Building ${cards.length} Anki cards…`, 92);
  pkg.writeToFile(`${deckName}.apkg`);
  return cards.length;
}

async function processPdf(file, fileIndex, totalFiles, client, model) {
  setStatus(`Loading ${file.name}…`, 6 + (fileIndex / totalFiles) * 5);
  const { pdf, buffer } = await loadPdf(file);
  const cards = await generatePdfCards(client, model, file, pdf, buffer);
  setStatus(`Validated ${cards.length} cards for ${file.name}.`, 66);
  const count = await createDeck(cards, safeDeckName(file.name), { pdf, fileIndex });
  return { name: file.name, count, pages: pdf.numPages };
}

async function processText(client, model) {
  const text = ui.textInput.value.trim();
  const chunks = [];
  for (let offset = 0; offset < text.length; offset += TEXT_CHUNK_LIMIT) chunks.push(text.slice(offset, offset + TEXT_CHUNK_LIMIT));
  const cards = [];
  for (let i = 0; i < chunks.length; i++) {
    setStatus(`Generating cards from text ${i + 1}/${chunks.length}…`, 20 + (i / chunks.length) * 50);
    const prompt = `${buildTextCardPrompt({ density: ui.density.value, language: ui.language.value })}\n\n${chunks[i]}`;
    cards.push(...normalizeCards(await client.generateJson({ model, prompt })));
  }
  const normalized = normalizeCards(cards);
  const deckName = 'StudyTools Text Deck';
  const count = await createDeck(normalized, deckName);
  return [{ name: deckName, count, pages: null }];
}

async function processJson() {
  let payload;
  try { payload = JSON.parse(ui.jsonInput.value); } catch (error) { throw new Error(`Invalid JSON: ${error.message}`); }
  const cards = normalizeCards(payload);
  const deckName = 'StudyTools JSON Deck';
  const count = await createDeck(cards, deckName);
  return [{ name: deckName, count, pages: null }];
}

function addSlideFile(file) {
  if (!file) return;
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    showError(new Error('Choose a PDF containing your slides.'));
    return;
  }
  state.slideFile = file;
  ui.slideFileList.innerHTML = `<div class="file-row"><div><strong>${escapeHtml(file.name)}</strong><span>${(file.size / 1024 / 1024).toFixed(1)} MB</span></div><button type="button" class="icon-button" data-remove-slide-file aria-label="Remove ${escapeHtml(file.name)}">×</button></div>`;
  clearError();
  updateGenerateState();
}

async function generateSlideExplanations(client, model, pdf) {
  const slides = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    setStatus(`Explaining slide ${pageNumber} of ${pdf.numPages}…`, 8 + ((pageNumber - 1) / pdf.numPages) * 72);
    const image = await renderPdfPage(pdf, pageNumber, 1600);
    const payload = await client.generateJson({
      model,
      prompt: buildSlideExplanationPrompt({ pageNumber, pageCount: pdf.numPages, language: ui.language.value }),
      images: [{ mimeType: 'image/jpeg', data: bytesToBase64(image) }]
    });
    slides.push(...normalizeSlideExplanations({ slides: [payload] }, 1).map(slide => ({ ...slide, pageNumber })));
  }
  return slides;
}

function drawWrappedText(page, font, text, x, y, maxWidth, fontSize, lineHeight, color) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
      page.drawText(line, { x, y, size: fontSize, font, color });
      y -= lineHeight;
      line = word;
    } else line = candidate;
  }
  if (line) { page.drawText(line, { x, y, size: fontSize, font, color }); y -= lineHeight; }
  return y;
}

async function exportExplanationPdf(file, slides) {
  const output = await PDFLib.PDFDocument.create();
  const source = await PDFLib.PDFDocument.load(await file.arrayBuffer());
  const regular = await output.embedFont(PDFLib.StandardFonts.Helvetica);
  const bold = await output.embedFont(PDFLib.StandardFonts.HelveticaBold);
  const margin = 38;
  const gap = 14;
  const navy = PDFLib.rgb(0.10, 0.16, 0.27);
  const muted = PDFLib.rgb(0.34, 0.39, 0.47);

  for (const slide of slides) {
    const original = source.getPage(slide.pageNumber - 1);
    const { width, height } = original.getSize();
    const page = output.addPage([width, height]);
    const embedded = await output.embedPage(original);
    const availableWidth = width - margin * 2;
    const slideArea = Math.min(height * 0.40, Math.max(150, height - 300));
    const scale = Math.min(availableWidth / embedded.width, slideArea / embedded.height);
    const imageWidth = embedded.width * scale;
    const imageHeight = embedded.height * scale;
    const imageY = height - margin - imageHeight;
    page.drawPage(embedded, { x: (width - imageWidth) / 2, y: imageY, width: imageWidth, height: imageHeight });

    let y = imageY - gap;
    page.drawText(`Slide ${slide.pageNumber}: ${slide.title}`, { x: margin, y, size: 14, font: bold, color: navy });
    y -= 22;
    y = drawWrappedText(page, regular, slide.explanation, margin, y, availableWidth, 9.5, 13, navy);
    for (const point of slide.keyPoints) {
      y = drawWrappedText(page, regular, `- ${point}`, margin + 8, y - 3, availableWidth - 8, 9, 12, navy);
    }
    for (const item of slide.terms) {
      y = drawWrappedText(page, regular, `${item.term}: ${item.meaning}`, margin + 8, y - 3, availableWidth - 8, 8.5, 11, muted);
    }
    if (y < margin) throw new Error(`The explanation for slide ${slide.pageNumber} is too long to fit below its slide. Shorten the explanation and try again.`);
  }

  const bytes = await output.save();
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const name = `${safeDeckName(file.name)} - explanations.pdf`;
  saveAs(blob, name);
  return { name, count: slides.length, pages: slides.length, kind: 'explanations' };
}

async function processSlides(client, model) {
  const file = state.slideFile;
  if (!file) throw new Error('Choose a slide PDF first.');
  setStatus(`Loading ${file.name}…`, 4);
  const { pdf } = await loadPdf(file);
  const slides = await generateSlideExplanations(client, model, pdf);
  setStatus('Building the slide explanations PDF…', 88);
  return [await exportExplanationPdf(file, slides)];
}

function renderResults(results) {
  ui.results.innerHTML = results.map(result => `
    <div class="result-card">
      <span class="result-check">✓</span>
      <div><strong>${escapeHtml(result.name)}</strong><p>${result.kind === 'explanations' ? `${result.count} explained slides` : `${result.count} cards`}${result.pages ? ` · ${result.pages} PDF pages` : ''} · download started</p></div>
    </div>`).join('');
}

async function generate() {
  clearError();
  state.busy = true;
  updateGenerateState();
  ui.results.innerHTML = '';
  try {
    const model = currentModel();
    localStorage.setItem(MODEL_STORAGE, model);
    const client = state.activeInput === 'json' ? null : new GeminiClient(apiKeys());
    let results;
    if (state.activeInput === 'pdf') {
      results = [];
      for (let i = 0; i < state.files.length; i++) results.push(await processPdf(state.files[i], i, state.files.length, client, model));
      setStatus('Done. Your Anki download has started.', 100);
    } else if (state.activeInput === 'slides') {
      results = await processSlides(client, model);
      setStatus('Done. Your explanations PDF download has started.', 100);
    } else if (state.activeInput === 'text') {
      results = await processText(client, model);
      setStatus('Done. Your Anki download has started.', 100);
    } else {
      results = await processJson();
      setStatus('Done. Your Anki download has started.', 100);
    }
    renderResults(results);
  } catch (error) {
    console.error(error);
    showError(error);
  } finally {
    state.busy = false;
    updateGenerateState();
  }
}

function saveKeys() {
  if (!ui.rememberKeys.checked) {
    localStorage.removeItem(API_KEY_STORAGE);
    setStatus('Key saving is off. Keys stay only in this tab.', 0);
    return;
  }
  localStorage.setItem(API_KEY_STORAGE, apiKeys());
  setStatus('Gemini keys saved in this browser only.', 0);
}

function clearKeys() {
  ui.apiKeys.value = '';
  ui.rememberKeys.checked = false;
  localStorage.removeItem(API_KEY_STORAGE);
  updateGenerateState();
  setStatus('Saved Gemini keys cleared.', 0);
}

function bindEvents() {
  ui.inputTabs.forEach(tab => tab.addEventListener('click', () => switchInput(tab.dataset.inputTab)));
  ui.fileInput.addEventListener('change', event => addFiles(event.target.files));
  ui.choosePdfs.addEventListener('click', event => { event.stopPropagation(); ui.fileInput.click(); });
  ui.dropzone.addEventListener('click', event => { if (!event.target.closest('button')) ui.fileInput.click(); });
  ui.dropzone.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') ui.fileInput.click(); });
  ['dragenter', 'dragover'].forEach(name => ui.dropzone.addEventListener(name, event => { event.preventDefault(); ui.dropzone.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach(name => ui.dropzone.addEventListener(name, event => { event.preventDefault(); ui.dropzone.classList.remove('dragging'); }));
  ui.dropzone.addEventListener('drop', event => addFiles(event.dataTransfer.files));
  ui.fileList.addEventListener('click', event => {
    const button = event.target.closest('[data-remove-file]');
    if (!button) return;
    state.files.splice(Number(button.dataset.removeFile), 1);
    renderFiles();
    updateGenerateState();
  });
  ui.apiKeys.addEventListener('input', updateGenerateState);
  ui.apiKeys.addEventListener('change', () => { if (apiKeys()) refreshModels().catch(error => console.warn('Model discovery failed; using curated fallback list.', error)); });
  ui.textInput.addEventListener('input', updateGenerateState);
  ui.jsonInput.addEventListener('input', updateGenerateState);
ui.explainSlides.addEventListener('click', () => {
  switchInput('slides');
  if (state.slideFile) runGeneration();
});
  ui.saveKeys.addEventListener('click', saveKeys);
  ui.clearKeys.addEventListener('click', clearKeys);
  ui.refreshModels.addEventListener('click', async () => { clearError(); try { await refreshModels(); } catch (error) { showError(error); } });
  ui.model.addEventListener('change', () => { localStorage.setItem(MODEL_STORAGE, currentModel()); updateModelMeta(); });
  ui.generate.addEventListener('click', generate);
  ui.explainSlides.addEventListener('click', generate);
  ui.chooseSlidePdf.addEventListener('click', event => { event.stopPropagation(); ui.slideFiles.click(); });
  ui.slideDropzone.addEventListener('click', event => { if (!event.target.closest('button')) ui.slideFiles.click(); });
  ui.slideDropzone.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') ui.slideFiles.click(); });
  ui.slideFiles.addEventListener('change', () => addSlideFile(ui.slideFiles.files?.[0]));
  ['dragenter', 'dragover'].forEach(name => ui.slideDropzone.addEventListener(name, event => { event.preventDefault(); ui.slideDropzone.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach(name => ui.slideDropzone.addEventListener(name, event => { event.preventDefault(); ui.slideDropzone.classList.remove('dragging'); }));
  ui.slideDropzone.addEventListener('drop', event => addSlideFile(event.dataTransfer.files?.[0]));
  ui.slideFileList.addEventListener('click', event => {
    if (!event.target.closest('[data-remove-slide-file]')) return;
    state.slideFile = null;
    ui.slideFiles.value = '';
    ui.slideFileList.innerHTML = '<p class="muted">No slide PDF selected.</p>';
    updateGenerateState();
  });
}

function init() {
  const savedKeys = localStorage.getItem(API_KEY_STORAGE) || '';
  if (savedKeys) { ui.apiKeys.value = savedKeys; ui.rememberKeys.checked = true; }
  state.models = mergeModelLists([], fallbackModelList());
  renderModelOptions();
  renderFiles();
  bindEvents();

  const params = new URLSearchParams(location.search);
  if (params.get('mode') === 'topics') ui.cardMode.value = 'topics';
  switchInput(params.get('input') || 'pdf');
  updateGenerateState();
  if (savedKeys) refreshModels().catch(error => console.warn('Model discovery failed; using curated fallback list.', error));
}

init();
