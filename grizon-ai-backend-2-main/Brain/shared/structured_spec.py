from typing import Any, Dict, Optional


def format_structured_spec(task: Dict[str, Any]) -> str:
    """Format the structured todo fields (files/ui/api/depends_on) into spec lines.

    Returns empty string when the task has no structured fields, so callers
    can skip the spec block entirely.
    """
    lines = []
    for field in ("files", "ui", "api", "depends_on"):
        vals = task.get(field)
        if not vals:
            continue
        joined = ", ".join(str(v) for v in vals) if isinstance(vals, list) else str(vals)
        if joined:
            lines.append(f"- {field}: {joined}")
    return "\n".join(lines)
