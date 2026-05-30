import re

with open('./jsonToAnki/jsonToAnki.html', 'r') as f:
    content = f.read()

# Update DEFAULT_MODELS
content = re.sub(
    r"openrouter:\s*'anthropic/claude-3\.7-sonnet'",
    "openrouter: 'openrouter/owl-alpha'",
    content
)

with open('./jsonToAnki/jsonToAnki.html', 'w') as f:
    f.write(content)
