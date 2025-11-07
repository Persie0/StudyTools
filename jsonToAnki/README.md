# JSON to Anki Deck Converter

Convert JSON data, PDF files, or text content into Anki flashcards effortlessly!

## Features

### Multiple Input Options

1. **JSON Input** - Traditional JSON format for direct flashcard creation
2. **PDF Upload** - Upload a PDF and let AI extract flashcards automatically
3. **Text Input** - Paste text content and let AI generate flashcards

### AI-Powered Flashcard Generation

For PDF and Text modes, the tool uses Google's Gemini AI to:
- Analyze your content
- Identify key concepts and facts
- Generate high-quality question-answer pairs
- Create 10-20 flashcards covering the most important points

## Usage

### JSON Mode

1. **Prepare your JSON data** in this format:
   ```json
   [
     {"front": "What is the capital of France?", "back": "Paris"},
     {"front": "What is 2 + 2?", "back": "4"}
   ]
   ```

2. **Upload JSON file** or paste directly into the text area
3. Click **"Generate Anki Deck"**
4. Download your `.apkg` file
5. Import into Anki

### PDF Mode

1. Click the **"PDF Upload"** tab
2. **Enter your Gemini API key** (get one [here](https://aistudio.google.com/app/apikey))
   - Your key is saved in your browser for convenience
3. **Upload your PDF file**
4. Optionally, customize the deck title
5. Click **"Generate Anki Deck"**
6. Wait for AI to process your PDF and generate flashcards
7. Download your `.apkg` file
8. Import into Anki

### Text Mode

1. Click the **"Text Input"** tab
2. **Enter your Gemini API key** (if not already saved)
3. **Paste your study material** into the text area
4. Optionally, customize the deck title
5. Click **"Generate Anki Deck"**
6. Wait for AI to analyze your text and generate flashcards
7. Download your `.apkg` file
8. Import into Anki

## JSON Format

For manual JSON creation, use this format:

```json
[
  {
    "front": "Question or prompt text",
    "back": "Answer or explanation"
  },
  {
    "front": "Another question",
    "back": "Another answer"
  }
]
```

## API Key Management

- **Save Key**: Store your API key in browser localStorage for future use
- **Clear Key**: Remove your saved API key from browser storage
- Your API key never leaves your browser and is only used for direct API calls to Google

## Privacy

- All processing happens in your browser
- PDF text extraction is done locally using PDF.js
- Your files are never uploaded to any server (except when calling Gemini API)
- API keys are stored locally in your browser

## Tips

- For PDF mode, ensure your PDF contains extractable text (not scanned images)
- The AI generates 10-20 cards by default, focusing on the most important concepts
- You can edit the deck title before generating to organize your Anki decks
- Use "Copy Example + Prompt" button to get a prompt for creating JSON with other AI tools

## Requirements

- Modern web browser with JavaScript enabled
- For PDF/Text modes: Google Gemini API key (free tier available)
- Internet connection (for loading libraries and AI API calls)

## Troubleshooting

**Problem**: No flashcards generated from PDF
- **Solution**: Ensure your PDF has extractable text. Scanned images won't work.

**Problem**: API key error
- **Solution**: Verify your Gemini API key is correct and active

**Problem**: JSON parse error
- **Solution**: Validate your JSON syntax using the example format

## Links

- [Get Gemini API Key](https://aistudio.google.com/app/apikey)
- [Anki Official Site](https://apps.ankiweb.net/)
- [Project Repository](https://github.com/Persie0/StudyTools)
