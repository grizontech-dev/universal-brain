from typing import Any, Dict
import os
import json
import re
import asyncio
from Brain.shared.agent import BaseAgent
from langchain_core.messages import SystemMessage, HumanMessage, ToolMessage, AIMessage
from Brain.shared.skills.resolver import SkillResolver
from Brain.agents.builder.mcp_tools import client_save_code, read_skill_file
from Brain.services.provider_router import ProviderRouter
from Brain.shared.structured_spec import format_structured_spec
from Brain.shared.llm_retry import ainvoke_with_retry


class FrontendAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="Frontend Agent",
            description="Specialized in HTML, CSS, JS, React, Angular, Tailwind CSS, and Bootstrap.",
            model_id="qwen/qwen3-coder"
        )
        # Instance-level cache — class-level dict caused cross-build skill contamination
        # between concurrent users (User A's skills leaking into User B's build)
        self._skill_cache: dict = {}
        self.skill_resolver = SkillResolver()
        # Cache bound model once — avoid recreating every execute()
        self.llm = ProviderRouter.get_model("qwen/qwen3-coder", temperature=0.1)
        self.fallback_model = ProviderRouter.get_model("deepseek-v4-flash", temperature=0.1)
        self.bound_llm = self.llm.bind_tools([client_save_code, read_skill_file])
        self.fallback_llm = self.fallback_model.bind_tools([client_save_code, read_skill_file])

    async def _safe_tool_call(self, tool, args, config=None):
        """Execute a tool call with error handling."""
        try:
            if config:
                return await asyncio.wait_for(tool.ainvoke(args, config=config), timeout=30)
            else:
                return await asyncio.wait_for(tool.ainvoke(args), timeout=30)
        except Exception as e:
            return e

    def _build_system_prompt(self, task: Dict, palette_colors: list, palette_name: str,
                              theme_preference: str, custom_color_input: str,
                              skills_content: str, framework: str,
                              skills_are_paths: bool = False,
                              contract_pages_block: str = "",
                              contract_api_block: str = "") -> str:
        """Build system prompt with contract data at the TOP for primacy bias."""

        c = palette_colors
        while len(c) < 5:
            c.append('#0f172a' if theme_preference == 'dark' else '#ffffff')

        # ── CONTRACT BLOCK (TOP — LLM reads this first, remembers it best) ──
        contract_section = ""
        if contract_pages_block or contract_api_block:
            contract_section = "═══ PROJECT CONTRACT (HIGHEST PRIORITY — follow these EXACTLY) ═══\n"
            if contract_pages_block:
                contract_section += f"{contract_pages_block}\n\n"
            if contract_api_block:
                contract_section += f"{contract_api_block}\n"
            contract_section += (
                "MANDATE: Every page listed above MUST be created AND have a <Route> in App.jsx.\n"
                "MANDATE: Every API helper listed above MUST be exported from lib/api.js.\n"
                "Do NOT invent page names or routes not listed above.\n\n"
            )

        prompt = f"""You are a Senior React Frontend Engineer. Stack: {framework} + Tailwind CSS + framer-motion + react-router-dom + lucide-react.

{contract_section}═══ COLOR PALETTE (USE EXACTLY — no other hex values) ═══
Palette: {palette_name} | Theme: {theme_preference}
- Base/Darkest: {c[0]}
- Primary/Accent: {c[1]}
- Secondary: {c[2]}
- Text: {c[3]}
- Background: {c[4]}
{f"Custom: {custom_color_input}" if custom_color_input else ""}
Use ONLY these hex values. Gradients: {c[1]}→{c[2]} | Buttons: {c[1]} | Text on dark: {c[3]}

═══ TOP 5 RULES (these break builds if violated) ═══
1. Save files with client_save_code. One call per file. Paths start with frontend/src/
2. App.jsx owns routing: one <BrowserRouter> wrapping <Routes>. NO other file renders any Router.
3. Every page in pages/ MUST have a <Route> in App.jsx. Every component MUST be imported somewhere.
4. api.js is the ONLY place for fetch calls. Export every function the components import by exact name.
5. Pure Tailwind for all styling. No ui/ subdirectory imports — that folder does not exist.
   Do NOT import from: '../components/ui/*', '@/...', 'shadcn/ui', or any path with 'shadcn'.
   Build all UI with Tailwind classes directly.

═══ STRUCTURE ═══
- pages/ → route-level pages (one <Route> per page in App.jsx)
- components/ → reusable pieces imported by pages
- lib/api.js → all fetch calls, exported by name, with ledger comment mapping name→route
- No TypeScript. No App.tsx. Plain JSX only.

═══ ROUTING (React Router v6) ═══
- <Routes> not <Switch>. element={{<X />}} not component={{X}}.
- Navigation: <Link to="/path"> not <a href>.
- App.jsx example:
  <BrowserRouter><Routes>
    <Route path="/" element={{<Home />}} />
    <Route path="/dashboard" element={{<Dashboard />}} />
  </Routes></BrowserRouter>

═══ API CONTRACT ═══
- api.js ledger at top: // getItems -> GET /api/items
- Components call named helpers: import {{ getItems }} from '../lib/api.js'
- Never hardcode /api URLs in components. Never mix api.js helpers with direct fetch.
- Auth (only if requested): loginUser/registerUser → /api/auth/login, /api/auth/register

═══ UI QUALITY ═══
- Real content only. Never <h1>Home Page</h1> as the only content.
- Animations: framer-motion on every page (AnimatePresence, motion.div, whileHover).
- Glass cards: bg-white/10 backdrop-blur-xl border border-white/20
- Port 9999 for Vite: --port 9999 --host 0.0.0.0 in vite.config.js

═══ PACKAGES ═══
- All deps in frontend/package.json. Return "commands": ["cd frontend && npm install"] when adding.
- Do NOT add "type": "module" to package.json. postcss.config.js uses module.exports (CommonJS).

═══ BATCH GENERATION ═══
Generate ALL files for this task in ONE response. Call client_save_code immediately — do not read skill files first.

{f"SKILL FILES (on-demand via read_skill_file):{chr(10)}{skills_content}" if skills_are_paths else (f"SKILLS:{chr(10)}{skills_content[:600]}" if skills_content and skills_content != '{{}}' else "")}

═══ OUTPUT FORMAT ═══
Respond ONLY in JSON.
ALWAYS update App.jsx when creating any page (pages/ directory).
Every page you create MUST have a <Route> in App.jsx.
{{"files": [...], "commands": [], "summary": "..."}}
"""
        return prompt

    async def execute(self, current_task: Dict[str, Any], state: Dict[str, Any]) -> Dict[str, Any]:
        task = current_task
        framework = (state.get("framework") or "react").lower()
        executed = state.get("executed_tasks", [])[-3:]  # Only last 3 tasks

        # Extract color palette — check state directly, then memory_context decisions as fallback
        color_palette = state.get("selected_color_palette", {})
        theme_preference = state.get("theme_preference", "dark")
        custom_color_input = state.get("custom_color_input", "")
        if not color_palette:
            # Correct fallback path: memory_context.decisions, not state.decisions
            memory_ctx = state.get("memory_context", {}) or {}
            decisions = memory_ctx.get("decisions", {}) or {}
            color_palette = decisions.get("color_palette", {})

        default_colors = ["#0f172a", "#3b82f6", "#60a5fa", "#f8fafc", "#1e293b"] if theme_preference == "dark" \
            else ["#ffffff", "#6366f1", "#818cf8", "#1e293b", "#f1f5f9"]
        palette_colors = color_palette.get("colors", default_colors)
        palette_name = color_palette.get("name", "Midnight Blue" if theme_preference == "dark" else "Clean Light")

        # Skill resolution with caching by task category
        task_description = f"{task.get('title', '')} {task.get('description', '')}"
        # Only skip for truly trivial UI primitives — NOT navbar, hero, footer, etc.
        simple_keywords = ["badge", "chip", "avatar", "spinner", "divider", "separator", "tooltip"]
        is_simple = len(task_description) < 60 and any(kw in task_description.lower() for kw in simple_keywords)

        skills_content = "{}"
        if not is_simple:
            # Cache by task category to avoid repeated resolution
            task_category = task.get("category", "general")
            if task_category in self._skill_cache:
                skills_content = self._skill_cache[task_category]
                print(f"[FRONTEND] Using cached skills for category: {task_category}", flush=True)
            else:
                try:
                    skills_content = self.skill_resolver.resolve_skills_for_task(task_description)
                    self._skill_cache[task_category] = skills_content
                except Exception:
                    skills_content = "{}"

        # Determine skills format BEFORE building system prompt and binding tools
        skills_are_paths = bool(skills_content and "SKILL FILES" in skills_content)
        skills_are_rules = bool(skills_content and skills_content != "{}" and not skills_are_paths)

        workspace_id = state.get("current_job_id")
        user_id = state.get("user_id")

        # ── Read build contract BEFORE building system prompt so blocks go to TOP ──
        _contract: dict = {}
        _contract_api_block = ""
        _contract_pages_block = ""
        _contract_palette_block = ""
        try:
            if workspace_id and not workspace_id.startswith("error:"):
                from Brain.shared.build_contract import (
                    read_contract,
                    format_api_contract_for_prompt,
                    format_pages_for_prompt,
                    format_palette_for_prompt,
                )
                from Brain.services.workspace_manager import workspace_manager as _wm_fe
                _ws_fe = _wm_fe.resolve_workspace_path(workspace_id, user_id=user_id)
                if _ws_fe:
                    _contract = read_contract(_ws_fe)
                    _contract_api_block = format_api_contract_for_prompt(_contract)
                    _contract_pages_block = format_pages_for_prompt(_contract)
                    _contract_palette_block = format_palette_for_prompt(_contract)
                    print(
                        f"[FRONTEND] [CONTRACT] Loaded ✓ | "
                        f"pages={len(_contract.get('pages', []))} "
                        f"api_routes={len(_contract.get('api_routes', []))} "
                        f"helpers={len(_contract.get('api_helpers', {}))} "
                        f"schema_names={_contract.get('schema_names', [])} "
                        f"components_created={len(_contract.get('components_created', []))} "
                        f"palette={'✓' if _contract.get('color_palette') else '✗'}",
                        flush=True,
                    )
                    if _contract_pages_block:
                        print(f"[FRONTEND] [CONTRACT] Pages injected to TOP of prompt:\n{_contract_pages_block}", flush=True)
                    if _contract_api_block:
                        print(f"[FRONTEND] [CONTRACT] API block injected to TOP of prompt:\n{_contract_api_block[:400]}", flush=True)
        except Exception as _cfe_err:
            print(f"[FRONTEND] [CONTRACT] read failed (non-fatal): {_cfe_err}", flush=True)

        # Prefer contract palette over state palette when contract has one
        if _contract.get("color_palette"):
            color_palette = _contract["color_palette"]
            theme_preference = _contract.get("theme_preference", theme_preference)
            custom_color_input = _contract.get("custom_color_input", custom_color_input)

        # Build compact system prompt — contract blocks now at TOP of prompt
        system_prompt = self._build_system_prompt(
            task, palette_colors, palette_name, theme_preference,
            custom_color_input, skills_content, framework,
            skills_are_paths=skills_are_paths,
            contract_pages_block=_contract_pages_block,
            contract_api_block=_contract_api_block,
        )

        # App.jsx context — skip for component-only tasks (Button, Card, Badge, etc.)
        component_only_keywords = ["button", "card", "badge", "input", "modal", "avatar", "spinner", "tooltip", "divider"]
        is_component_only = any(kw in task.get("title", "").lower() for kw in component_only_keywords)

        app_jsx_context = ""
        api_js_context = ""
        backend_route_context = ""

        app_jsx_context = ""
        api_js_context = ""
        backend_route_context = ""
        if not is_component_only and workspace_id and not workspace_id.startswith("error:"):
            from Brain.services.workspace_manager import workspace_manager
            ws_root = workspace_manager.resolve_workspace_path(workspace_id, user_id=user_id)
            if ws_root:
                app_jsx_path = os.path.join(ws_root, "frontend", "src", "App.jsx")
                if os.path.exists(app_jsx_path):
                    try:
                        with open(app_jsx_path, "r", encoding="utf-8") as f:
                            content = f.read()
                        # Extract only routes and imports (not full content)
                        import re
                        imports = [m.group(0) for m in re.finditer(r"import\s+.*?from\s+['\"].*?['\"]", content)]
                        # Match single-line, multi-line, and nested Route definitions
                        routes = [m.group(0).replace('\n', ' ').strip() for m in re.finditer(r"<Route\s+[^>]*?/?>", content)]
                        summary_parts = []
                        if imports:
                            summary_parts.append(f"Imports ({len(imports)}): " + "; ".join(imports[:8]))
                        if routes:
                            summary_parts.append(f"Routes ({len(routes)}): " + "; ".join(routes[:6]))
                        summary_parts.append(f"Lines: {len(content.splitlines())}")
                        app_jsx_context = f"\n\nCURRENT App.jsx: {' | '.join(summary_parts)}\nOnly update App.jsx if required by this task. Otherwise leave it unchanged."
                    except Exception:
                        pass
                api_js_path = os.path.join(ws_root, "frontend", "src", "lib", "api.js")
                if os.path.exists(api_js_path):
                    try:
                        with open(api_js_path, "r", encoding="utf-8") as f:
                            api_content = f.read()
                        exports = re.findall(r"export\s+(?:async\s+function|function|const|let|var)\s+(\w+)", api_content)
                        routes = sorted(set(re.findall(r"['\"](/api/[^'\"]*)['\"]", api_content)))
                        parts = []
                        if exports:
                            parts.append(f"Exports ({len(exports)}): " + ", ".join(exports[:20]))
                        if routes:
                            parts.append(f"Routes ({len(routes)}): " + ", ".join(routes[:20]))
                        parts.append(f"Lines: {len(api_content.splitlines())}")
                        api_js_context = f"\n\nCURRENT frontend/src/lib/api.js: {' | '.join(parts)}\nBefore importing any API helper, ensure this file exports that exact name. Update api.js in the same batch when helpers/routes change."
                    except Exception:
                        pass
                server_js_path = os.path.join(ws_root, "backend", "server.js")
                if os.path.exists(server_js_path):
                    try:
                        with open(server_js_path, "r", encoding="utf-8") as f:
                            server_content = f.read()
                        mounts = [m.group(0) for m in re.finditer(r"app\.use\(['\"].*?['\"].*?\)", server_content)]
                        health = [m.group(0) for m in re.finditer(r"app\.get\(['\"]/(?:api/)?health['\"]", server_content)]
                        parts = []
                        if mounts:
                            parts.append(f"Mounts ({len(mounts)}): " + "; ".join(mounts[:12]))
                        if health:
                            parts.append("Health endpoints present")
                        parts.append(f"Lines: {len(server_content.splitlines())}")
                        backend_route_context = f"\n\nCURRENT backend/server.js routes: {' | '.join(parts)}\nUse these exact mounted /api routes from frontend helpers. If a needed route is missing, do not fake it in the component; generate/update api.js and let backend task own the route."
                    except Exception:
                        pass

        # Inject api_contract from BackendAgent if available — gives exact route→helper mapping
        api_contract = state.get("api_contract", {})
        if api_contract:
            contract_lines = []
            for route, helpers in api_contract.items():
                contract_lines.append(
                    f"  {route}: GET→{helpers['get']}(), POST→{helpers['post']}(), "
                    f"PUT→{helpers['put']}(), DELETE→{helpers['delete']}()"
                )
            backend_route_context += (
                "\n\nAPI CONTRACT (use EXACTLY these helper names in api.js — do not invent new names):\n"
                + "\n".join(contract_lines)
            )
        # Note: contract pages/API blocks are already at TOP of system prompt (primacy position).
        # Do NOT re-inject them here — it wastes tokens and dilutes the top-of-prompt signal.

        # Compact executed tasks context
        executed_context = ""
        if executed:
            summaries = [t.get("title", "task") for t in executed if t.get("status") == "completed"]
            executed_context = f"\nDone: {', '.join(summaries)}" if summaries else ""

        # Compact structured spec
        structured_hint = format_structured_spec(task)
        spec_context = f"\nSpec: {structured_hint[:800]}" if structured_hint else ""

        # For integration/wiring tasks: scan disk and provide REAL file list
        # so LLM doesn't have to guess which components/pages exist
        integration_file_context = ""
        task_title_lower = task.get("title", "").lower()
        task_desc_lower = task.get("description", "").lower()
        is_integration = any(k in task_title_lower or k in task_desc_lower
                             for k in ("wire", "integrat", "app.jsx", "router", "connect", "mount", "wiring"))
        if is_integration and workspace_id and ws_root:
            try:
                fe_src = os.path.join(ws_root, "frontend", "src")
                pages_files = []
                component_files = []
                for sub in ("pages", "components"):
                    sub_dir = os.path.join(fe_src, sub)
                    if os.path.isdir(sub_dir):
                        for root_w, _, files_w in os.walk(sub_dir):
                            for f_w in files_w:
                                if f_w.endswith((".jsx", ".js", ".tsx")):
                                    rel = os.path.relpath(
                                        os.path.join(root_w, f_w), fe_src
                                    ).replace("\\", "/")
                                    full_path = f"frontend/src/{rel}"
                                    if sub == "pages":
                                        pages_files.append(full_path)
                                    else:
                                        component_files.append(full_path)

                all_files = sorted(pages_files) + sorted(component_files)
                if all_files:
                    # Also inject current App.jsx content so LLM can merge properly
                    current_app_content = ""
                    app_jsx_path_full = os.path.join(fe_src, "App.jsx")
                    if os.path.isfile(app_jsx_path_full):
                        try:
                            with open(app_jsx_path_full, "r", encoding="utf-8") as _af:
                                current_app_content = _af.read()
                        except Exception:
                            pass

                    integration_file_context = (
                        "\n\n══ INTEGRATION TASK — MANDATORY STEPS ══\n"
                        "You MUST rewrite App.jsx completely using the files listed below.\n"
                        "Do NOT skip this. Do NOT leave any file without a route.\n\n"
                        "PAGES (each needs a <Route path=... element=<Component />> in App.jsx):\n"
                        + "\n".join(f"  {f}" for f in pages_files)
                        + ("\n\nCOMPONENTS (import and render Navbar/Footer in App.jsx if present):\n"
                           + "\n".join(f"  {f}" for f in component_files) if component_files else "")
                        + "\n\nREQUIREMENTS:"
                        "\n  1. Import every page above and give it a <Route> in <Routes>."
                        "\n  2. Import Navbar/Footer components if they exist and render them around <Routes>."
                        "\n  3. Use React Router v6: <BrowserRouter><Routes><Route path=... element=<X /> /></Routes></BrowserRouter>"
                        "\n  4. Save the COMPLETE new App.jsx with client_save_code."
                        + (f"\n\nCURRENT App.jsx (preserve existing routes, add missing ones):\n```jsx\n{current_app_content[:2000]}\n```"
                           if current_app_content else "")
                        # Contract pages supplement — ensures planned pages that aren't on disk yet
                        # are still listed so the LLM creates stubs for them
                        + (f"\n\nBUILD CONTRACT — PLANNED PAGES (include ALL even if file not yet on disk):\n{_contract_pages_block}"
                           if _contract_pages_block and _contract else "")
                        + (f"\n\nBUILD CONTRACT — CONFIRMED API HELPERS (use in api.js):\n{_contract_api_block}"
                           if _contract_api_block else "")
                    )
            except Exception:
                pass

        # Build user message — compact
        user_content = (
            f"Task: {task.get('title')}\n"
            f"Description: {task.get('description', '')}"
            f"{spec_context}"
            f"{executed_context}"
            f"{app_jsx_context}"
            f"{api_js_context}"
            f"{backend_route_context}"
            f"{integration_file_context}"
        )

        # Initialize messages
        msgs = [SystemMessage(content=system_prompt), HumanMessage(content=user_content)]

        print(f"[FRONTEND] model=qwen/qwen3-coder | temp=0.1 | task={task.get('title', 'N/A')}", flush=True)

        # Bind read_skill_file ONLY when skills actually exist. Otherwise Qwen burns
        # its iteration budget calling read_skill_file on project files (which the
        # tool cannot read) and never reaches client_save_code.
        # skills_are_paths / skills_are_rules already computed above after skill resolution.
        if skills_are_rules:
            # Skills already compiled — no need to read files, save tool call budget
            active_llm = self.llm.bind_tools([client_save_code])
            fallback_llm = self.fallback_model.bind_tools([client_save_code])
        elif skills_are_paths:
            # Skills are file paths — agent may read them on demand
            active_llm = self.bound_llm
            fallback_llm = self.fallback_llm
        else:
            # No skills — just save tool
            active_llm = self.llm.bind_tools([client_save_code])
            fallback_llm = self.fallback_model.bind_tools([client_save_code])

        files_saved = set()  # Use set to prevent duplicates
        max_iterations = 8  # Qwen explores (read_skill_file) before saving — allow budget
        fallback_tried = False

        for iteration in range(max_iterations):
            try:
                response = await ainvoke_with_retry(
                    active_llm, msgs, 120,
                    tag="FRONTEND",
                    fallback_llm=fallback_llm if not fallback_tried else None,
                    max_retries=3,
                    backoff_base=5.0,
                    backoff_max=60.0,
                )
            except asyncio.TimeoutError:
                print(f"[FRONTEND] Timeout after 120s (iteration {iteration+1})", flush=True)
                if not fallback_tried:
                    print(f"[FRONTEND] ↻ Timeout — switching to deepseek-v4-flash permanently", flush=True)
                    active_llm = fallback_llm
                    fallback_tried = True
                    continue
                break
            except Exception as e:
                err_str = str(e)
                is_rate_limit = ("429" in err_str or "RateLimit" in type(e).__name__
                                 or "engine_overloaded" in err_str or "Model busy" in err_str)
                is_reasoning_error = "reasoning_content" in err_str
                if (is_rate_limit or is_reasoning_error) and not fallback_tried:
                    print(f"[FRONTEND] ↻ LLM error ({'rate limit' if is_rate_limit else 'reasoning_content'}) — switching to fallback permanently", flush=True)
                    active_llm = fallback_llm
                    fallback_tried = True
                    continue
                print(f"[FRONTEND] LLM error: {e}", flush=True)
                break

            msgs.append(response)

            if not response.tool_calls:
                # Early-exit guard: if files were already saved this run, treat a no-tool-call
                # response as a natural completion signal — do NOT fire corrective prompts.
                if files_saved:
                    print(f"[FRONTEND] ✓ Clean completion — {len(files_saved)} files saved, LLM signalled done", flush=True)
                    break

                last_content = response.content
                if isinstance(last_content, list):
                    last_content = str(last_content)
                is_empty = (
                    last_content is None
                    or (isinstance(last_content, str) and not last_content.strip())
                )
                if is_empty:
                    print(f"[FRONTEND] ↻ Empty response (iteration {iteration+1}) — retrying with corrective prompt", flush=True)
                    msgs.append(SystemMessage(
                        content="Your previous response was empty. You MUST respond by calling the "
                               "client_save_code tool for EVERY file. Do not return plain text — make tool calls."
                    ))
                    continue
                parsed = self._format_json_response(last_content) if isinstance(last_content, str) else None
                if isinstance(parsed, dict) and "files" in parsed:
                    break
                print(f"[FRONTEND] Malformed response (iteration {iteration+1}) — retrying with corrective prompt", flush=True)
                msgs.append(SystemMessage(
                    content="Your previous response was empty or invalid. You MUST respond by calling the "
                           "client_save_code tool for EVERY file. Do not return plain text — make tool calls."
                ))
                continue

            # Execute tool calls in parallel if multiple save operations
            save_calls = [tc for tc in response.tool_calls if tc["name"] == "client_save_code"]
            skill_calls = [tc for tc in response.tool_calls if tc["name"] == "read_skill_file"]

            # Execute skill reads first (parallel)
            if skill_calls:
                skill_results = await asyncio.gather(*[
                    self._safe_tool_call(read_skill_file, tc["args"]) for tc in skill_calls
                ], return_exceptions=True)
                for tc, result in zip(skill_calls, skill_results):
                    if isinstance(result, Exception):
                        msgs.append(ToolMessage(content=f"Error: {result}", tool_call_id=tc["id"]))
                    else:
                        msgs.append(ToolMessage(content=result, tool_call_id=tc["id"]))

            # Execute saves in parallel (parallel)
            if save_calls:
                save_configs = [{"configurable": {
                    "thread_id": state.get("current_job_id"),
                    "task_title": task.get("title", ""),
                    "user_id": state.get("user_id")
                }} for _ in save_calls]

                save_results = await asyncio.gather(*[
                    self._safe_tool_call(client_save_code, tc["args"], config)
                    for tc, config in zip(save_calls, save_configs)
                ], return_exceptions=True)

                for tc, result in zip(save_calls, save_results):
                    file_path = tc["args"].get("file_path", "")
                    code_content = tc["args"].get("code_content", "")
                    if isinstance(result, Exception):
                        print(f"[FRONTEND] ✖ Failed: {file_path}: {result}", flush=True)
                        msgs.append(ToolMessage(content=f"Error: {result}", tool_call_id=tc["id"]))
                    else:
                        files_saved.add(file_path)  # set.add() instead of list.append()
                        print(f"[FRONTEND] ✓ Saved: {file_path} ({len(code_content)} chars)", flush=True)
                        msgs.append(ToolMessage(
                            content=f"Saved: {file_path} ({len(code_content)} chars)",
                            tool_call_id=tc["id"]
                        ))

            # The model explored (read_skill_file etc.) but produced no files this round —
            # nudge it to save NOW so it doesn't burn the whole iteration budget exploring.
            if not save_calls and iteration < max_iterations - 1:
                print(f"[FRONTEND] ↻ No saves this round (tool_calls={len(response.tool_calls)}) — nudging to save files", flush=True)
                msgs.append(SystemMessage(
                    content="You explored the workspace, but you did NOT save any files. STOP exploring. "
                           "Use the client_save_code tool to save the required files NOW — every file, "
                           "one tool call each. Do not call read_skill_file again."
                ))

        if not files_saved:
            last_msg = msgs[-1] if msgs else None
            # Only LLM responses can contain JSON; tool result messages never do.
            if isinstance(last_msg, AIMessage):
                last_content = last_msg.content
                if isinstance(last_content, list):
                    last_content = str(last_content)
                if isinstance(last_content, str) and last_content.strip():
                    parsed = self._format_json_response(last_content)
                    if isinstance(parsed, dict) and "files" in parsed:
                        return parsed

        if files_saved:
            # Record saved components into the shared build contract
            try:
                if workspace_id and not workspace_id.startswith("error:"):
                    from Brain.shared.build_contract import record_components
                    from Brain.services.workspace_manager import workspace_manager as _wm_rec
                    _ws_rec = _wm_rec.resolve_workspace_path(workspace_id, user_id=user_id)
                    if _ws_rec:
                        record_components(_ws_rec, list(files_saved))
                        print(f"[FRONTEND] [CONTRACT] Recorded {len(files_saved)} components to contract", flush=True)
            except Exception as _rec_err:
                print(f"[FRONTEND] [CONTRACT] component record failed (non-fatal): {_rec_err}", flush=True)

            return {
                "status": "completed",
                "files": [{"path": f, "content": ""} for f in sorted(files_saved)],
                "summary": f"Saved {len(files_saved)} files via tool calls"
            }
        return {"files": [], "summary": "No files saved"}
