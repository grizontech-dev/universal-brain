import os
from typing import Any, Dict

DB_MODE_SHARED = "shared"
DB_MODE_PHYSICAL = "physical"


def normalize_db_storage_mode(value: str, fallback: str = DB_MODE_SHARED) -> str:
    if not isinstance(value, str):
        return fallback
    v = value.strip().lower()
    if v in (DB_MODE_SHARED, DB_MODE_PHYSICAL):
        return v
    return fallback


def resolve_db_storage_mode(state: Dict[str, Any] | None = None) -> str:
    """Resolve DB storage mode with connector-aware override.

    Resolution order:
    1) DB_STORAGE_MODE_FORCE (shared|physical)
    2) If planner detected connected user Supabase connector:
       DB_STORAGE_MODE_CONNECTED_SUPABASE (default: DB_STORAGE_MODE_DEFAULT)
    3) DB_STORAGE_MODE_DEFAULT (default: shared)
    """
    state = state or {}
    default_mode = normalize_db_storage_mode(os.getenv("DB_STORAGE_MODE_DEFAULT", DB_MODE_SHARED))

    forced_mode = normalize_db_storage_mode(os.getenv("DB_STORAGE_MODE_FORCE", ""), fallback="")
    if forced_mode:
        return forced_mode

    active_decisions = state.get("active_decisions", {}) or {}
    supabase_mode = str(active_decisions.get("supabase_mode", "")).strip().lower()

    if supabase_mode == "connected-user":
        connector_mode = normalize_db_storage_mode(
            os.getenv("DB_STORAGE_MODE_CONNECTED_SUPABASE", DB_MODE_PHYSICAL),
            fallback=default_mode,
        )
        return connector_mode

    return default_mode
