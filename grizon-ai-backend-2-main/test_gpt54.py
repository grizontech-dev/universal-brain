"""
GPT-5.4 Model Migration Test Script
====================================
Verifies that all agents and services are correctly configured to use gpt-5.4
and that the OpenAI API accepts the model.
"""

import os
import sys
import json
import asyncio
import importlib.util
from pathlib import Path
from dotenv import load_dotenv

# Load env from project root
load_dotenv(Path(__file__).parent / ".env")

PASS = "\033[92m✓ PASS\033[0m"
FAIL = "\033[91m✗ FAIL\033[0m"
INFO = "\033[94mℹ INFO\033[0m"
results = []

def check(label, condition, detail=""):
    status = PASS if condition else FAIL
    results.append((label, condition))
    print(f"  {status} {label}" + (f" — {detail}" if detail else ""))
    return condition

# ============================================================
# PART 1: Static file verification — no gpt-4o references remain
# ============================================================
print("\n" + "=" * 60)
print("PART 1: Static Model Reference Check")
print("=" * 60)

# Files that SHOULD use gpt-5.4
python_agents = [
    "Brain/agents/builder/builder_agent.py",
    "Brain/agents/manager/manager_agent.py",
    "Brain/agents/planner/planner_agent.py",
    "Brain/agents/runner/runner_agent.py",
    "Brain/agents/watcher/watcher_agent.py",
    "Brain/agents/reporter/reporter_agent.py",
    "Brain/agents/todo/todo_agent.py",
    "Brain/agents/questions/questions_agent.py",
    "Brain/agents/leader_agent.py",
    "Brain/sub_agents/backend/backend_agent.py",
    "Brain/sub_agents/frontend/frontend_agent.py",
    "Brain/shared/agent.py",
    "Brain/shared/review_loop.py",
    "Brain/shared/skills/resolver.py",
    "Brain/services/provider_router.py",
    "Brain/services/brain_chat_service.py",
    "Brain/modules/chat/service.py",
]

base = Path(__file__).parent

print("\n[A] Checking Python Brain agents for gpt-5.4...")
for f in python_agents:
    path = base / f
    if not path.exists():
        check(f, False, f"FILE NOT FOUND: {f}")
        continue
    content = path.read_text(encoding="utf-8")
    has_old = '"gpt-4o"' in content or "'gpt-4o'" in content
    has_new = '"gpt-5.4"' in content or "'gpt-5.4'" in content
    check(f, has_new and not has_old,
          "still has gpt-4o!" if has_old else ("has gpt-5.4" if has_new else "no model ref found"))

# TypeScript backend files
ts_files = [
    "src/runtime/systemModel.ts",
    "src/router/catalogue.ts",
    "src/tools/imageAnalyse.tool.ts",
    "src/services/routerCapture.service.ts",
    "src/router/searchPlanner.ts",
    "src/router/queryRewriter.ts",
    "src/router/classifier.ts",
    "src/memory/vector.memory.ts",
]

print("\n[B] Checking TypeScript backend files for gpt-5.4 / gpt-5.4-mini...")
for f in ts_files:
    path = base / f
    if not path.exists():
        check(f, False, f"FILE NOT FOUND: {f}")
        continue
    content = path.read_text(encoding="utf-8")
    has_old = '"gpt-4o"' in content or '"gpt-4o-mini"' in content
    has_new = '"gpt-5.4"' in content or '"gpt-5.4-mini"' in content
    check(f, has_new and not has_old,
          "still has gpt-4o!" if has_old else ("has gpt-5.x" if has_new else "no model ref found"))

# ============================================================
# PART 2: Live OpenAI API test
# ============================================================
print("\n" + "=" * 60)
print("PART 2: Live OpenAI API Call Test")
print("=" * 60)

api_key = os.getenv("OPENAI_API_KEY")
base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")

if not api_key:
    check("OPENAI_API_KEY exists", False, "Key not found in .env")
else:
    check("OPENAI_API_KEY exists", True, f"Key starts with {api_key[:12]}...")

    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key, base_url=base_url if base_url else None)

        # Test gpt-5.4
        print(f"\n[C] Calling gpt-5.4 via {base_url or 'default'}...")
        try:
            resp = client.chat.completions.create(
                model="gpt-5.4",
                messages=[
                    {"role": "system", "content": "Reply with exactly: GPT-5.4 WORKING"},
                    {"role": "user", "content": "Confirm you are operational."}
                ],
                max_completion_tokens=50,
                temperature=0,
            )
            reply = resp.choices[0].message.content.strip()
            model_used = resp.model
            tokens_in = resp.usage.prompt_tokens
            tokens_out = resp.usage.completion_tokens
            check("gpt-5.4 API call", True, f"model={model_used}, reply='{reply}', tokens={tokens_in}+{tokens_out}")
        except Exception as e:
            check("gpt-5.4 API call", False, f"{type(e).__name__}: {e}")

        # Test gpt-5.4-mini
        print(f"\n[D] Calling gpt-5.4-mini...")
        try:
            resp2 = client.chat.completions.create(
                model="gpt-5.4-mini",
                messages=[
                    {"role": "system", "content": "Reply with exactly: GPT-5.4-MINI WORKING"},
                    {"role": "user", "content": "Confirm you are operational."}
                ],
                max_completion_tokens=50,
                temperature=0,
            )
            reply2 = resp2.choices[0].message.content.strip()
            model_used2 = resp2.model
            check("gpt-5.4-mini API call", True, f"model={model_used2}, reply='{reply2}'")
        except Exception as e:
            check("gpt-5.4-mini API call", False, f"{type(e).__name__}: {e}")

    except ImportError:
        check("openai package installed", False, "pip install openai")
    except Exception as e:
        check("OpenAI client init", False, str(e))

# ============================================================
# PART 3: Verify Python imports work (no syntax errors)
# ============================================================
print("\n" + "=" * 60)
print("PART 3: Python Import / Syntax Check")
print("=" * 60)

# Quick syntax check by compiling key files
key_py_files = [
    "Brain/shared/agent.py",
    "Brain/services/provider_router.py",
    "Brain/agents/builder/builder_agent.py",
    "Brain/agents/manager/manager_agent.py",
    "Brain/agents/planner/planner_agent.py",
]

print("\n[E] Syntax check (compile)...")
for f in key_py_files:
    path = base / f
    if not path.exists():
        check(f, False, "NOT FOUND")
        continue
    try:
        compile(path.read_text(encoding="utf-8"), str(path), "exec")
        check(f, True, "syntax OK")
    except SyntaxError as e:
        check(f, False, f"SyntaxError at line {e.lineno}: {e.msg}")

# ============================================================
# SUMMARY
# ============================================================
print("\n" + "=" * 60)
total = len(results)
passed = sum(1 for _, ok in results if ok)
failed = total - passed
print(f"RESULTS: {passed}/{total} passed, {failed} failed")
if failed == 0:
    print("\033[92m  ALL TESTS PASSED — gpt-5.4 migration is correct!\033[0m")
else:
    print(f"\033[91m  {failed} TEST(S) FAILED — check output above.\033[0m")
print("=" * 60)

sys.exit(0 if failed == 0 else 1)
