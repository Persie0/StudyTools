import re

with open('./slidesToAnki/gemini-anki-topics.html', 'r') as f:
    content = f.read()

# Update PROVIDER_DEFAULT_MODELS
content = re.sub(
    r"openrouter:\s*\{\s*topic:\s*'[^']+',\s*explanation:\s*'[^']+'\s*\}",
    "openrouter: {\n                topic: 'openrouter/owl-alpha',\n                explanation: 'openrouter/owl-alpha'\n            }",
    content
)

# Update PROVIDER_MODEL_OPTIONS to add owl-alpha
# Look for anthropic/claude-3.7-sonnet and insert before it
content = re.sub(
    r"(\{ value: 'anthropic/claude-3.7-sonnet')",
    r"{ value: 'openrouter/owl-alpha', label: 'Owl Alpha (Default)' },\n                \1",
    content
)

with open('./slidesToAnki/gemini-anki-topics.html', 'w') as f:
    f.write(content)
