from typing import Any, Dict
import os
import json
import asyncio
from Brain.shared.agent import BaseAgent
from langchain_core.messages import SystemMessage, HumanMessage, ToolMessage, AIMessage
from Brain.shared.skills.resolver import SkillResolver
from Brain.agents.builder.mcp_tools import client_save_code, read_skill_file
from Brain.services.provider_router import ProviderRouter
from Brain.shared.structured_spec import format_structured_spec
from Brain.shared.llm_retry import ainvoke_with_retry


class FrontendAgent(BaseAgent):
    # Class-level skill cache: {task_category: skills_content}
    _skill_cache = {}

    def __init__(self):
        super().__init__(
            name="Frontend Agent",
            description="Specialized in HTML, CSS, JS, React, Angular, Tailwind CSS, and Bootstrap.",
            model_id="qwen/qwen3-coder"
        )
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
                              skills_content: str, framework: str) -> str:
        """Build compact system prompt (~1500 tokens)."""

        c = palette_colors
        while len(c) < 5:
            c.append('#0f172a' if theme_preference == 'dark' else '#ffffff')

        prompt = f"""You are a Senior React Frontend Engineer. Stack: {framework} + Tailwind CSS + framer-motion + react-router-dom + lucide-react.

═══ COLOR PALETTE (USE EXACTLY — NON-NEGOTIABLE) ═══
Palette: {palette_name} | Theme: {theme_preference}
- Base/Darkest: {c[0]}
- Primary/Accent: {c[1]}
- Secondary: {c[2]}
- Text: {c[3]}
- Background: {c[4]}
{f"Custom: {custom_color_input}" if custom_color_input else ""}
Gradients: c[1]→c[2] | Buttons/links: c[1] | Text on dark: c[3]

═══ RULES (VIOLATION = BROKEN BUILD) ═══
1. Use client_save_code for EVERY file. One tool call per file.
2. File paths MUST start with frontend/src/ (e.g., frontend/src/App.jsx)
3. Import EVERY component at top of file. Do NOT re-declare imported names.
4. Use react-router-dom Link, NOT <a href>. Routes NOT Switch. element={{<X />}} NOT component={{X}}.
5. Do NOT import CSS files (Tailwind is global). Do NOT use brand icons (Github, Google, Twitter).
6. NO orphan components: every file MUST be imported in App.jsx AND rendered.
7. NO duplicate files: pages in pages/, reusable UI in components/. Never both.
8. NO TypeScript: use plain JSX, no React.FC types. No App.tsx — use App.jsx only.
9. EVERY component needs real Tailwind styling — NEVER output <h1>Home Page</h1> as only content.
10. Connect forms/data to backend via frontend/src/lib/api.js (apiGet, apiPost, apiPut, apiDelete). NEVER import browser Supabase client.
11. ALL packages MUST be in frontend/package.json. Return "commands": ["cd frontend && npm install"] when adding deps.
12. Vite dev server MUST run on port 9999: add --port 9999 --host 0.0.0.0 to vite.config.js or package.json.

═══ PREMIUM UI (NON-NEGOTIABLE) ═══
- Animations: framer-motion. EVERY page: AnimatePresence, motion.div, whileHover, whileInView, skeleton loaders.
- Glass: bg-white/10 backdrop-blur-xl border border-white/20
- Shadows: shadow-2xl shadow-[c[1]]/20
- Typography: font-bold tracking-tight, gradient text bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent
- Layout: Hero full-width gradient, Cards glass+hover glow, Navbar sticky glass, Footer multi-column
- Spacing: p-6 to p-12, generous breathing room

═══ BATCH GENERATION (SPEED) ═══
Generate ALL related files in ONE response (2-5 tool calls). This cuts time 40-60%.

{f"SKILL FILES (read via read_skill_file when needed):{chr(10)}{skills_content}" if skills_content and skills_content != "{{}}" else ""}

═══ OUTPUT FORMAT ═══
Respond ONLY in JSON.
Update App.jsx ONLY IF: new page, new route, new layout, new navigation, new provider, or imports changed.
Otherwise DO NOT generate App.jsx — just create the component files.
{{"files": [...], "commands": [], "summary": "..."}}
"""
        return prompt

    async def execute(self, current_task: Dict[str, Any], state: Dict[str, Any]) -> Dict[str, Any]:
        task = current_task
        framework = (state.get("framework") or "react").lower()
        executed = state.get("executed_tasks", [])[-3:]  # Only last 3 tasks

        # Extract color palette
        color_palette = state.get("selected_color_palette", {})
        theme_preference = state.get("theme_preference", "dark")
        custom_color_input = state.get("custom_color_input", "")
        if not color_palette:
            decisions = state.get("decisions", {})
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
            if task_category in FrontendAgent._skill_cache:
                skills_content = FrontendAgent._skill_cache[task_category]
                print(f"[FRONTEND] Using cached skills for category: {task_category}", flush=True)
            else:
                try:
                    skills_content = self.skill_resolver.resolve_skills_for_task(task_description)
                    FrontendAgent._skill_cache[task_category] = skills_content
                except Exception:
                    skills_content = "{}"

        # Build compact system prompt
        system_prompt = self._build_system_prompt(
            task, palette_colors, palette_name, theme_preference,
            custom_color_input, skills_content, framework
        )

        # App.jsx context — skip for component-only tasks (Button, Card, Badge, etc.)
        component_only_keywords = ["button", "card", "badge", "input", "modal", "avatar", "spinner", "tooltip", "divider"]
        is_component_only = any(kw in task.get("title", "").lower() for kw in component_only_keywords)

        workspace_id = state.get("current_job_id")
        user_id = state.get("user_id")
        app_jsx_context = ""
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

        # Compact executed tasks context
        executed_context = ""
        if executed:
            summaries = [t.get("title", "task") for t in executed if t.get("status") == "completed"]
            executed_context = f"\nDone: {', '.join(summaries)}" if summaries else ""

        # Compact structured spec
        structured_hint = format_structured_spec(task)
        spec_context = f"\nSpec: {structured_hint[:800]}" if structured_hint else ""

        # Build user message — compact
        user_content = (
            f"Task: {task.get('title')}\n"
            f"Description: {task.get('description', '')}"
            f"{spec_context}"
            f"{executed_context}"
            f"{app_jsx_context}"
        )

        # Initialize messages
        msgs = [SystemMessage(content=system_prompt), HumanMessage(content=user_content)]

        print(f"[FRONTEND] model=qwen/qwen3-coder | temp=0.1 | task={task.get('title', 'N/A')}", flush=True)

        # Bind read_skill_file ONLY when skills actually exist. Otherwise Qwen burns
        # its iteration budget calling read_skill_file on project files (which the
        # tool cannot read) and never reaches client_save_code.
        if skills_content and skills_content != "{}":
            active_llm = self.bound_llm
            fallback_llm = self.fallback_llm
        else:
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

        return {"files": [{"path": f, "content": ""} for f in sorted(files_saved)], "summary": f"Saved {len(files_saved)} files via tool calls"}
