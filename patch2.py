import re

with open('./slidesToAnki/gemini-anki.html', 'r') as f:
    content = f.read()

# Make sure openrouter is included correctly because the last patch might have matched something else or been partially successful
if "'openrouter/owl-alpha'" in content and "openrouter: [" in content:
    print("Already applied")
else:
    print("Need to fix")
