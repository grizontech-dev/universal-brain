"""Ensure Vite entry (main.jsx → App.jsx) is the only app root — not App.tsx."""
import re
from typing import Any, Dict, List, Tuple

APP_JSX = "frontend/src/App.jsx"
APP_TSX = "frontend/src/App.tsx"
MAIN_JSX = "frontend/src/main.jsx"

BOILERPLATE_MARKERS = (
    "Grizon React",
    "ready for Brain to extend",
    "Count:",
    "useState(0)",
    "Welcome",
    "Brain will mount",
    "Brain MUST replace this file",
)


def _norm_path(path: str) -> str:
    return (path or "").replace("\\", "/").lstrip("/")


def is_app_jsx_path(path: str) -> bool:
    p = _norm_path(path)
    return p == APP_JSX or p.endswith("/App.jsx")


def is_app_tsx_path(path: str) -> bool:
    p = _norm_path(path)
    return p == APP_TSX or p.endswith("/App.tsx")


def is_boilerplate_app(content: str) -> bool:
    if not content:
        return True
    return any(m in content for m in BOILERPLATE_MARKERS)


def tsx_to_jsx(content: str) -> str:
    """Light strip of TypeScript syntax for Vite JSX entry."""
    lines: List[str] = []
    for line in content.split("\n"):
        if re.match(r"^\s*import\s+type\s+", line):
            continue
        line = re.sub(r":\s*React\.FC(?:<[^>]*>)?\s*=\s*", " = ", line)
        line = re.sub(r":\s*React\.FC(?:<[^>]*>)?\s*", "", line)
        line = re.sub(r":\s*JSX\.Element\b", "", line)
        line = re.sub(r"<\s*[^>]+\s*>\s*\(\s*\)", "", line)  # FC<Props>() empty generics on const
        lines.append(line)
    return "\n".join(lines).strip() + "\n"


def ensure_main_imports_app_jsx(content: str) -> str:
    if "App.jsx" in content:
        return content
    fixed = re.sub(
        r"from\s+['\"]\.\/App(\.tsx)?['\"]",
        "from './App.jsx'",
        content,
    )
    if "App.jsx" not in fixed:
        fixed = fixed.replace("from './App'", "from './App.jsx'")
    return fixed


def normalize_frontend_entry_files(
    files: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], bool]:
    """
    - Redirect App.tsx → App.jsx (main.jsx only imports App.jsx).
    - Never emit App.tsx to the workspace.
    - Returns (normalized_files, should_delete_app_tsx).
    """
    other: List[Dict[str, Any]] = []
    app_jsx: Dict[str, Any] | None = None
    app_tsx_content: str | None = None
    main_jsx: Dict[str, Any] | None = None

    for f in files or []:
        path = _norm_path(f.get("path", ""))
        content = f.get("content")
        if content is None:
            continue
        if is_app_tsx_path(path):
            app_tsx_content = content
            continue
        if is_app_jsx_path(path):
            app_jsx = {"path": APP_JSX, "content": content}
            continue
        if path == MAIN_JSX or path.endswith("/main.jsx"):
            main_jsx = {"path": MAIN_JSX, "content": ensure_main_imports_app_jsx(content)}
            continue
        other.append(f)

    should_delete_tsx = app_tsx_content is not None

    if app_tsx_content is not None:
        tsx_as_jsx = tsx_to_jsx(app_tsx_content)
        if app_jsx is None or is_boilerplate_app(str(app_jsx.get("content", ""))):
            app_jsx = {"path": APP_JSX, "content": tsx_as_jsx}
        elif len(tsx_as_jsx) > len(str(app_jsx.get("content", ""))):
            app_jsx = {"path": APP_JSX, "content": tsx_as_jsx}

    out = list(other)
    if app_jsx is not None:
        out.append(app_jsx)
    if main_jsx is not None:
        out.append(main_jsx)
    elif should_delete_tsx or app_jsx is not None:
        out.append(
            {
                "path": MAIN_JSX,
                "content": (
                    "import React from 'react';\n"
                    "import ReactDOM from 'react-dom/client';\n"
                    "import './index.css';\n"
                    "import App from './App.jsx';\n\n"
                    "ReactDOM.createRoot(document.getElementById('root')).render(\n"
                    "  <React.StrictMode>\n"
                    "    <App />\n"
                    "  </React.StrictMode>\n"
                    ");\n"
                ),
            }
        )

    return out, should_delete_tsx
