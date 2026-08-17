"""
Build Contract — shared source of truth written to {workspace}/build_contract.json.

Every sub-agent reads from and writes to this file so that:
  - DatabaseAgent records exact schema_name values
  - BackendAgent records exact mounted routes + helper names
  - FrontendAgent reads routes/helpers/pages and generates correct code
  - ValidationGate cross-checks the contract against actual files

File is created once by BuilderAgent at task index 0, then updated atomically
by each sub-agent (read → merge → write).  All I/O is synchronous and file-locked
via a simple rename-swap so concurrent agents in the same process cannot corrupt it.
"""

from __future__ import annotations

import json
import os
import time
import re
from typing import Any, Dict, List, Optional

CONTRACT_FILENAME = "build_contract.json"

# ──────────────────────────────────────────────────────────────────────────────
# Low-level helpers
# ──────────────────────────────────────────────────────────────────────────────

def _contract_path(workspace_dir: str) -> str:
    return os.path.join(workspace_dir, CONTRACT_FILENAME)


def read_contract(workspace_dir: str) -> Dict[str, Any]:
    """Return the current contract dict, or an empty-schema dict if not found."""
    path = _contract_path(workspace_dir)
    if not os.path.isfile(path):
        print(f"[CONTRACT] ⚠ build_contract.json not found at {path} — returning empty contract", flush=True)
        return _empty_contract()
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        print(
            f"[CONTRACT] 📖 Read | pages={len(data.get('pages', []))} "
            f"api_routes={len(data.get('api_routes', []))} "
            f"helpers={len(data.get('api_helpers', {}))} "
            f"schema_names={data.get('schema_names', [])} "
            f"components={len(data.get('components_created', []))}",
            flush=True,
        )
        return data
    except Exception as e:
        print(f"[CONTRACT] ⚠ Could not read {path}: {e}", flush=True)
        return _empty_contract()


def update_contract(workspace_dir: str, patch: Dict[str, Any]) -> Dict[str, Any]:
    """
    Deep-merge *patch* into the existing contract and write it back.
    Lists in *patch* **replace** (not append to) the existing list under the same key,
    except for 'components_created' which accumulates (union).
    Returns the updated contract.
    """
    contract = read_contract(workspace_dir)

    for key, value in patch.items():
        if key == "components_created" and isinstance(value, list):
            existing = contract.get("components_created", [])
            merged = list(dict.fromkeys(existing + value))
            contract["components_created"] = merged
            print(f"[CONTRACT] 📝 components_created → {len(merged)} total files", flush=True)
        elif key == "schema_names" and isinstance(value, list):
            # Accumulate — multiple DB tasks each add their schema names
            existing = contract.get("schema_names", [])
            merged = sorted(set(existing + value))
            contract["schema_names"] = merged
            print(f"[CONTRACT] 📝 schema_names (merged) → {merged}", flush=True)
        elif key == "api_helpers" and isinstance(value, dict):
            existing = contract.get("api_helpers", {})
            existing.update(value)
            contract["api_helpers"] = existing
            print(f"[CONTRACT] 📝 api_helpers merged → {len(existing)} helpers", flush=True)
        else:
            contract[key] = value
            if key not in ("_updated_at", "_created_at"):
                _log_val = value if not isinstance(value, list) else f"[{len(value)} items]"
                print(f"[CONTRACT] 📝 {key} → {_log_val}", flush=True)

    contract["_updated_at"] = int(time.time())
    _write_contract(workspace_dir, contract)
    return contract


def create_contract(workspace_dir: str, state: Dict[str, Any]) -> Dict[str, Any]:
    """
    Called once by BuilderAgent at task index 0.
    Bootstraps the contract from planning-time state so every agent starts with
    a known palette, page list, and placeholder route arrays.
    Overwrites any existing contract (safe: called only at build start).
    """
    contract = _empty_contract()

    # Project name
    project_plan = state.get("project_plan", {}) or {}
    contract["project_name"] = (
        project_plan.get("project_name")
        or state.get("content", "")[:60]
        or "Untitled Project"
    )

    # Color palette — prefer state keys, then memory_context decisions, then contextual scan
    color_palette = (
        state.get("selected_color_palette")
        or state.get("color_palette")
        or {}
    )
    if not color_palette:
        mem = state.get("memory_context", {}) or {}
        decisions = mem.get("decisions", {}) or {}
        color_palette = (
            decisions.get("color_palette")
            or decisions.get("selected_color_palette")
            or decisions.get("palette")
            or {}
        )

    # Search in user prompt text, project_plan, or messages if still empty
    if not color_palette:
        try:
            from Brain.agents.questions.questions_agent import COLOR_PALETTES
            all_text = (
                str(state.get("content", "")) + " " +
                str(state.get("project_plan", "")) + " " +
                str([m.get("content", "") for m in state.get("messages", []) if isinstance(m, dict)])
            ).lower()
            for p in COLOR_PALETTES:
                if p["name"].lower() in all_text or p["id"].lower() in all_text:
                    color_palette = p
                    state["theme_preference"] = p.get("theme", "dark")
                    print(f"[CONTRACT] 🎨 Resolved palette from context: {p['name']}", flush=True)
                    break
        except Exception:
            pass

    # If still empty, use a clean default so palette=✓ always
    if not color_palette:
        _prompt_lower = (state.get("content", "") or "").lower()
        if "dark" in _prompt_lower or "coral" in _prompt_lower:
            color_palette = {
                "id": "midnight-blue",
                "name": "Midnight Blue",
                "colors": ["#0f172a", "#3b82f6", "#60a5fa", "#f8fafc", "#1e293b"],
                "theme": "dark"
            }
            contract["theme_preference"] = "dark"
        else:
            color_palette = {
                "id": "clean-light",
                "name": "Clean Light",
                "colors": ["#ffffff", "#6366f1", "#818cf8", "#1e293b", "#f8fafc"],
                "theme": "light"
            }
            contract["theme_preference"] = "light"
        print(f"[CONTRACT] 🎨 Fallback palette: {color_palette['name']}", flush=True)
    else:
        print(f"[CONTRACT] 🎨 Active palette bound to contract: {color_palette.get('name', 'Custom')}", flush=True)

    contract["color_palette"] = color_palette or {}
    contract["theme_preference"] = state.get("theme_preference", color_palette.get("theme", "light"))
    contract["custom_color_input"] = state.get("custom_color_input", "")

    # Pages — prefer planner's architecture output (exact names + routes),
    # fall back to extracting from task titles only if architecture has nothing.
    arch = project_plan.get("architecture", {}) or {}
    arch_pages = arch.get("pages", [])

    if arch_pages and isinstance(arch_pages, list):
        pages = []
        for p in arch_pages:
            name = p.get("name", "").strip()
            if not name:
                continue
            route = p.get("route", "")
            if not route:
                # Derive route from name if planner didn't provide one
                import re as _re
                slug = _re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
                route = f"/{slug}"
            # Ensure name is PascalCase for the component filename
            pascal = "".join(w.capitalize() for w in re.split(r"[\s\-_]+", name))
            pages.append({
                "name": pascal,
                "route": route,
                "file": f"frontend/src/pages/{pascal}.jsx",
                "task_title": name,
                "components": p.get("components", []),
            })
        print(f"[CONTRACT] Pages from architecture: {[p['name'] for p in pages]}", flush=True)
    else:
        # Fallback: derive from task plan titles
        pages = _extract_pages_from_plan(state.get("plan", []))
        print(f"[CONTRACT] Pages from task plan (fallback): {[p['name'] for p in pages]}", flush=True)

    contract["pages"] = pages

    # Planned API routes from project_plan architecture
    planned_routes = arch.get("api_routes", [])
    if isinstance(planned_routes, list):
        contract["planned_api_routes"] = planned_routes
        # Pre-seed api_routes from planner so FrontendAgent has something even
        # before BackendAgent runs and overwrites with confirmed routes.
        if planned_routes:
            seeded_routes = []
            seeded_helpers: dict = {}
            for r in planned_routes:
                if not isinstance(r, dict):
                    continue
                path = r.get("path", "")
                method = r.get("method", "GET").upper()
                if not path:
                    continue
                # Skip param-segment paths like /api/todos/:id — detail routes,
                # not resource roots. /api/todos already covers them.
                last_seg = path.strip("/").split("/")[-1]
                if last_seg.startswith(":"):
                    continue
                # Derive clean CamelCase resource name from path segment
                resource_raw = last_seg.replace("-", "_")
                parts = [p for p in resource_raw.split("_") if p]
                camel = "".join(p.capitalize() for p in parts) if parts else "Resource"
                singular = camel[:-1] if camel.endswith("s") and len(camel) > 2 else camel
                # Map method to correct helper verb
                if method == "GET":
                    handler = f"get{camel}"
                elif method == "POST":
                    handler = f"create{singular}"
                elif method in ("PUT", "PATCH"):
                    handler = f"update{singular}"
                elif method == "DELETE":
                    handler = f"delete{singular}"
                else:
                    handler = f"call{camel}"
                seeded_routes.append({"path": path, "method": method, "handler": handler})
                seeded_helpers[handler] = f"{method} {path}"
            contract["api_routes"] = seeded_routes
            contract["api_helpers"] = seeded_helpers
            print(f"[CONTRACT] Pre-seeded {len(seeded_routes)} routes from planner architecture | helpers={list(seeded_helpers.keys())}", flush=True)

    # Planned tables/schema names from planner — gives DatabaseAgent a head start
    planned_tables = arch.get("tables", [])
    if isinstance(planned_tables, list):
        planned_schema_names = [
            t.get("name", "").lower().strip()
            for t in planned_tables
            if isinstance(t, dict) and t.get("name")
        ]
        if planned_schema_names:
            contract["schema_names"] = planned_schema_names
            print(f"[CONTRACT] Schema names from architecture: {planned_schema_names}", flush=True)

    contract["_created_at"] = int(time.time())
    contract["_updated_at"] = int(time.time())

    _write_contract(workspace_dir, contract)
    print(
        f"[CONTRACT] Created build_contract.json | project='{contract['project_name']}' "
        f"| pages={len(pages)} | palette={'yes' if color_palette else 'no'}",
        flush=True,
    )
    return contract


# ──────────────────────────────────────────────────────────────────────────────
# Agent-specific update helpers
# ──────────────────────────────────────────────────────────────────────────────

def record_schema_names(workspace_dir: str, schema_names: List[str]) -> None:
    """DatabaseAgent calls this after extracting schema_names_used from SQL.
    Accumulates across multiple DB tasks — never shrinks the list."""
    if not schema_names:
        print(f"[CONTRACT] ⚠ record_schema_names called with empty list — skipping", flush=True)
        return
    # Read existing and merge — multiple DB tasks may run (users table, todos table)
    existing = read_contract(workspace_dir).get("schema_names", [])
    merged = sorted(set(existing + schema_names))
    update_contract(workspace_dir, {"schema_names": merged})
    print(f"[CONTRACT] ✅ schema_names confirmed (merged): {merged}", flush=True)


def record_api_routes(workspace_dir: str, mounted_routes: List[Dict[str, str]], helpers: Dict[str, str]) -> None:
    """BackendAgent calls this after saving server.js."""
    update_contract(workspace_dir, {
        "api_routes": mounted_routes,
        "api_helpers": helpers,
    })
    print(
        f"[CONTRACT] ✅ api_routes confirmed: {[r['path'] for r in mounted_routes]} | "
        f"helpers: {list(helpers.keys())}",
        flush=True,
    )


def record_components(workspace_dir: str, file_paths: List[str]) -> None:
    """FrontendAgent calls this after saving each batch of files."""
    if not file_paths:
        return
    update_contract(workspace_dir, {"components_created": file_paths})
    print(f"[CONTRACT] ✅ components recorded (+{len(file_paths)}): {file_paths}", flush=True)


# ──────────────────────────────────────────────────────────────────────────────
# Formatting helpers — used by agents to inject contract into prompts
# ──────────────────────────────────────────────────────────────────────────────

def format_api_contract_for_prompt(contract: Dict[str, Any]) -> str:
    """Return a compact prompt block with confirmed routes and helpers."""
    lines: List[str] = []

    routes = contract.get("api_routes", [])
    helpers = contract.get("api_helpers", {})
    schema_names = contract.get("schema_names", [])

    if routes:
        lines.append("CONFIRMED API ROUTES (use EXACTLY these — no inventing new paths):")
        for r in routes:
            path = r.get("path", "")
            method = r.get("method", "GET")
            handler = r.get("handler", "")
            lines.append(f"  {method} {path}  →  {handler}()")
        lines.append("")

    if helpers:
        lines.append("CONFIRMED API HELPERS for frontend/src/lib/api.js (use EXACTLY these names):")
        for name, route in sorted(helpers.items()):
            lines.append(f"  {name}  →  {route}")
        lines.append("")

    if schema_names:
        lines.append(f"CONFIRMED DB SCHEMA_NAMES: {', '.join(schema_names)}")
        lines.append("")

    return "\n".join(lines) if lines else ""


def format_pages_for_prompt(contract: Dict[str, Any]) -> str:
    """Return a compact prompt block listing all planned pages."""
    pages = contract.get("pages", [])
    if not pages:
        return ""
    lines = ["ALL PAGES (every page MUST have a <Route> in App.jsx):"]
    for p in pages:
        name = p.get("name", "")
        route = p.get("route", "")
        file_ = p.get("file", "")
        lines.append(f"  {name}  →  route={route}  file={file_}")
    return "\n".join(lines)


def format_palette_for_prompt(contract: Dict[str, Any]) -> str:
    """Return a compact prompt block with exact hex values."""
    palette = contract.get("color_palette", {})
    if not palette:
        return ""
    theme = contract.get("theme_preference", "dark")
    custom = contract.get("custom_color_input", "")
    colors = palette.get("colors", [])
    name = palette.get("name", "")
    if not colors:
        return ""
    while len(colors) < 5:
        colors.append("#0f172a" if theme == "dark" else "#ffffff")
    lines = [
        f"COLOR PALETTE: {name} | Theme: {theme}",
        f"  Base:       {colors[0]}",
        f"  Primary:    {colors[1]}",
        f"  Secondary:  {colors[2]}",
        f"  Text:       {colors[3]}",
        f"  Background: {colors[4]}",
    ]
    if custom:
        lines.append(f"  Custom:     {custom}")
    return "\n".join(lines)


# ──────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ──────────────────────────────────────────────────────────────────────────────

def _empty_contract() -> Dict[str, Any]:
    return {
        "project_name": "",
        "color_palette": {},
        "theme_preference": "light",
        "custom_color_input": "",
        "pages": [],
        "planned_api_routes": [],
        "api_routes": [],
        "api_helpers": {},
        "schema_names": [],
        "components_created": [],
        "app_jsx_snapshot": "",
        "_created_at": 0,
        "_updated_at": 0,
    }


def _write_contract(workspace_dir: str, contract: Dict[str, Any]) -> None:
    """Atomic write via temp file + rename to avoid partial reads."""
    os.makedirs(workspace_dir, exist_ok=True)
    path = _contract_path(workspace_dir)
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(contract, f, indent=2)
        _atomic_rename(tmp, path)
        print(f"[CONTRACT] 💾 Saved build_contract.json ({os.path.getsize(path)} bytes)", flush=True)
    except Exception as e:
        print(f"[CONTRACT] ⚠ Atomic write failed: {e} — trying direct write", flush=True)
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(contract, f, indent=2)
            print(f"[CONTRACT] 💾 Saved build_contract.json via fallback write", flush=True)
        except Exception as e2:
            print(f"[CONTRACT] ✖ WRITE FAILED completely: {e2}", flush=True)


def _atomic_rename(src: str, dst: str) -> None:
    """Cross-platform atomic rename with one retry on Windows PermissionError."""
    try:
        os.replace(src, dst)
    except PermissionError:
        time.sleep(0.05)
        os.replace(src, dst)


def _extract_pages_from_plan(tasks: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    """
    Derive page definitions from the task plan.
    A page is any frontend task whose title mentions a page/screen/view name.
    """
    pages: List[Dict[str, str]] = []
    seen_routes: set = set()

    # Common page-like keywords that indicate a whole page/screen
    page_keywords = (
        "page", "screen", "view", "dashboard", "home", "login", "register",
        "signup", "profile", "settings", "landing", "about", "contact",
        "list", "detail", "form", "checkout", "cart", "invoice", "report",
        "analytics", "pipeline", "kanban", "board", "feed", "chat", "messages",
    )

    for task in tasks:
        if task.get("category") != "frontend":
            continue
        title = task.get("title", "")
        title_lower = title.lower()

        if not any(kw in title_lower for kw in page_keywords):
            continue

        # Derive component name: take first meaningful word group, PascalCase it
        # e.g. "Lead Scoring Dashboard" → "LeadScoringDashboard", route "/lead-scoring-dashboard"
        # Strip filler words
        filler = {"page", "screen", "view", "the", "a", "an", "build", "create",
                  "implement", "add", "make", "design", "develop"}
        words = [w for w in re.split(r"[\s\-_/]+", title) if w.lower() not in filler]
        if not words:
            continue

        component_name = "".join(w.capitalize() for w in words[:4])  # max 4 words
        route = "/" + "-".join(w.lower() for w in words[:4])

        if route in seen_routes:
            continue
        seen_routes.add(route)

        pages.append({
            "name": component_name,
            "route": route,
            "file": f"frontend/src/pages/{component_name}.jsx",
            "task_title": title,
        })

    return pages
