import re
src = open("/app/Brain/modules/chat/service.py").read()
lines = src.split("\n")
found = False
for i, l in enumerate(lines):
    if "async def process_chat_stream" in l:
        found = True
    if found:
        indent = len(l) - len(l.lstrip())
        if "yield" in l and indent < 15:
            print(f"Line {i+1} (indent={indent}): {l.strip()[:120]}")
        if "Phase 2" in l:
            print(f"Line {i+1} (indent={indent}): {l.strip()[:120]}")
        if "finally:" in l and indent < 10:
            print(f"Line {i+1} (indent={indent}): {l.strip()[:120]}")
    if found and i > 500 and "async def" in l and "process_chat_stream" not in l:
        break
