# Study Tools

A collection of browser-based PDF manipulation tools designed to enhance your study workflow. All tools work entirely in your browser - no server uploads required!

## Table of Contents
- [Available Tools](#available-tools)
  - [PDF Chapter Splitter](#1-pdf-chapter-splitter)
  - [PDF Slides to Anki Converter](#2-pdf-slides-to-anki-converter)
  - [PDF Page Stripper](#3-pdf-page-stripper)
  - [JSON to Anki Deck Converter](#4-json-to-anki-deck-converter)
- [Common Features](#features-common-to-all-tools)
- [Privacy](#privacy)
- [License](#license)

## Available Tools

### 1. AI-Powered PDF to Anki Converter
Convert PDF presentations into Anki flashcards with AI-powered content analysis.
- Automatically groups related slides
- Generates concise explanations with Google's Gemini AI
- Creates structured Anki cards with key concepts
- Processes content directly in your browser
- [Try AI Anki Converter](./slidesToAnki/gemini-anki.html)

### 2. PDF Chapter Splitter
Split large PDFs into smaller chapter-based files - perfect for working with AI tools that have token limits.
- Automatic chapter detection from PDF outline
- Adjustable splitting depth
- Results delivered as ZIP file
- [Try PDF Chapter Splitter](./pdfSplitter/pdf-splitter.html)

### 3. PDF Slides to Anki Converter
Transform your PDF presentations into Anki flashcards automatically.
- Creates cards with slide title as front and full slide as back
- Option to merge slides with identical titles
- Real-time progress tracking
- [Try Basic Slides to Anki Converter](./slidesToAnki/slidesanki.html)

### 3. PDF Page Stripper
Clean up incrementally built presentation slides by removing intermediate steps.
- Keeps only final/complete slides
- Multiple comparison modes
- Batch processing support
- [Try PDF Page Stripper](./pdfPageStripper/stripper.html)

### 4. JSON to Anki Deck Converter
Convert JSON, PDF, or text content into Anki flashcards - now with AI support!
- **Three input modes**: JSON, PDF upload, or text input
- **AI-powered**: Uses Gemini AI to automatically generate flashcards from PDFs and text
- **Flexible**: Direct JSON input for manual control
- Instant feedback on JSON validity
- [Try JSON to Anki Deck Converter](./jsonToAnki/jsonToAnki.html)

## Features Common to All Tools
- Drag & drop file upload
- Complete browser-based processing
- No server uploads - your files remain private
- Modern, easy-to-use interfaces

## Local Development & Testing

Since these tools process files in the browser, opening the `.html` files directly via `file://` might cause issues with some browser security policies (CORS). It is recommended to use a local static file server for testing.

### Start a Local Server

You can start a local server in the project root using any of the following methods:

**Option 1: Python (Built-in)**
```bash
python3 -m http.server 8000
```
Then visit: `http://localhost:8000`

**Option 2: Node.js (npx)**
```bash
npx serve .
```
Then visit: `http://localhost:3000`

**Option 3: VS Code (Live Server)**
If you use VS Code, you can install the **Live Server** extension and click "Go Live" at the bottom of the editor.

## Privacy
All processing happens directly in your browser. Your files are never uploaded to any server, ensuring complete privacy and data security.

## License
MIT License
