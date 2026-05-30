import re

with open('./slidesToAnki/gemini-anki.html', 'r') as f:
    content = f.read()

# Update PROVIDER_DEFAULT_MODEL
content = re.sub(
    r"openrouter: 'anthropic/claude-3.7-sonnet'",
    "openrouter: 'openrouter/owl-alpha'",
    content
)

# Update PROVIDER_MODEL_OPTIONS to add openrouter
openrouter_models = """            ]
       ,
            openrouter: [
                { value: 'openrouter/owl-alpha', label: 'Owl Alpha (Default)', pdfSupport: false, recommended: true },
                { value: 'anthropic/claude-3.7-sonnet', label: 'Claude 3.7 Sonnet', pdfSupport: false, recommended: true },
                { value: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet', pdfSupport: false, recommended: true },
                { value: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku', pdfSupport: false, recommended: false },
                { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', pdfSupport: false, recommended: true },
                { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', pdfSupport: false, recommended: false },
                { value: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B Instruct', pdfSupport: false, recommended: true },
                { value: 'openai/o3-mini', label: 'o3-mini', pdfSupport: false, recommended: false },
                { value: 'deepseek/deepseek-chat', label: 'DeepSeek V3', pdfSupport: false, recommended: true },
                { value: 'custom', label: 'Custom Model...', pdfSupport: false, recommended: false }
            ]"""

content = re.sub(
    r"            \]\n\s*\}",
    openrouter_models + "\n        }",
    content,
    count=1
)

with open('./slidesToAnki/gemini-anki.html', 'w') as f:
    f.write(content)
