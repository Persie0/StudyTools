import re

with open('./slidesToAnki/gemini-anki-topics.html', 'r') as f:
    content = f.read()

# Add openrouter to modelSelectionsByProvider
content = re.sub(
    r"gemini:\s*\{\s*\.\.\.PROVIDER_DEFAULT_MODELS\.gemini\s*\},",
    "gemini: { ...PROVIDER_DEFAULT_MODELS.gemini },\n            openrouter: { ...PROVIDER_DEFAULT_MODELS.openrouter },",
    content
)

with open('./slidesToAnki/gemini-anki-topics.html', 'w') as f:
    f.write(content)
