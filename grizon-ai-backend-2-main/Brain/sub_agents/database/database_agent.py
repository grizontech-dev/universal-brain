from typing import Any, Dict
import asyncio
from Brain.shared.agent import BaseAgent
from Brain.shared.build_standards import DATABASE_BUILD_STANDARDS
from Brain.shared.skills.resolver import SkillResolver
from Brain.shared.structured_spec import format_structured_spec
from Brain.services.provider_router import ProviderRouter
from langchain_core.messages import SystemMessage, HumanMessage


class DatabaseAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="Database Agent",
            description="Specialized in company-owned Supabase schema design and MCP connectors.",
            model_id="deepseek-v4-flash"
        )
        # Instance-level cache — avoids cross-build skill contamination between concurrent users
        self._skill_cache: dict = {}
        self.skill_resolver = SkillResolver()
        # Cache model once
        self.llm = ProviderRouter.get_model("deepseek-v4-flash", temperature=0.1)

    def _get_skill_cache_key(self, task: Dict, task_description: str) -> str:
        """Generate granular cache key based on DB task type."""
        desc_lower = task_description.lower()
        if any(kw in desc_lower for kw in ["migration", "migrate", "alter", "drop"]):
            return "database_migration"
        elif any(kw in desc_lower for kw in ["rls", "row level security", "policy", "access control"]):
            return "database_rls"
        elif any(kw in desc_lower for kw in ["seed", "seed data", "mock data", "dummy"]):
            return "database_seed"
        elif any(kw in desc_lower for kw in ["index", "optimize", "performance", "query"]):
            return "database_indexes"
        elif any(kw in desc_lower for kw in ["schema", "table", "create table", "column"]):
            return "database_schema"
        else:
            return "database_general"

    def _build_system_prompt(self, task: Dict, skills_content: str) -> str:
        prompt = f"""You are the Database Agent for Grizon Brain. Supabase/PostgreSQL schema design.

{DATABASE_BUILD_STANDARDS}

SKILL FILES (reference only):
{skills_content}

=== RULES (NON-NEGOTIABLE) ===
1. Output SQL in `backend/supabase/schema.sql` ONLY.
2. CRITICAL: Use ONLY the shared `tenant_connector_vault` table. NEVER create domain-specific tables like `users`, `tasks`, `messages`, etc. All data lives in `tenant_connector_vault` as JSONB rows, filtered by `tenant_id` + `schema_name`.
3. Ensure `tenant_connector_vault` exists with: id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL, schema_name text NOT NULL, record_data jsonb NOT NULL DEFAULT '{{}}'::jsonb, created_at timestamptz DEFAULT now().
4. Add GIN index on `record_data` and btree index on `(tenant_id, schema_name)` for query performance.
5. Enable Row Level Security (RLS) with a permissive policy for initial setup:
   ALTER TABLE public.tenant_connector_vault ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "allow_all" ON public.tenant_connector_vault FOR ALL USING (true) WITH CHECK (true);
   GRANT ALL ON public.tenant_connector_vault TO service_role, anon, authenticated;
6. Use IF NOT EXISTS to prevent re-run errors.
7. After DDL, append: NOTIFY pgrst, 'reload schema';
8. commands: always [].
9. UNIVERSAL DATA CONTRACT: For each requested feature/resource, store rows in `tenant_connector_vault` with `schema_name = '<canonical_resource>'` using lowercase snake_case or kebab-derived snake_case (for example `projects`, `invoices`, `contact_messages`). Do NOT create physical domain tables for any app feature.
10. AUTH DATA CONTRACT (ONLY WHEN REQUESTED): Do NOT create a `users` table for login/register. Auth rows are stored with `schema_name = 'auth_users'` and JSONB keys such as email, name, passwordHash, role, createdAt. Add expression indexes only when useful, for example lower(record_data->>'email') where schema_name = 'auth_users'.

=== OUTPUT FORMAT ===
Respond ONLY in JSON. The JSON `content` field contains SQL — follow these rules to keep JSON valid:
- Use $$ dollar-quoting for SQL strings/functions instead of single quotes where possible
- Escape any single quotes inside SQL strings as: '' (two single quotes)
- NEVER use unescaped backslashes inside the JSON string
- Keep the entire response as one valid JSON object — no markdown, no code fences

SCHEMA_NAMES CONTRACT (critical for backend/frontend alignment):
In your `summary` field, list EVERY schema_name you used, like this:
  "schema_names_used": ["invoices", "auth_users", "products"]
The backend agent MUST query these exact schema_name values. If you use 'invoice' the backend
must also use 'invoice' — not 'invoices'. Be consistent. Use plural snake_case by default.

{{"files": [{{"path": "backend/supabase/schema.sql", "content": "-- SQL here"}}], "commands": [], "summary": "...", "schema_names_used": ["resource1", "resource2"]}}
"""
        return prompt

    async def execute(self, current_task: Dict[str, Any], state: Dict[str, Any]) -> Dict[str, Any]:
        task = current_task
        task_description = f"{task.get('title', '')} {task.get('description', '')}"

        # Skill resolution with granular caching — DB tasks are never simple
        cache_key = self._get_skill_cache_key(task, task_description)
        if cache_key in self._skill_cache:
            skills_content = self._skill_cache[cache_key]
            print(f"[DB] Using cached skills: {cache_key}", flush=True)
        else:
            try:
                skills_content = self.skill_resolver.resolve_skills_for_task(task_description)
                self._skill_cache[cache_key] = skills_content
                print(f"[DB] Cached skills for: {cache_key}", flush=True)
            except Exception:
                skills_content = "{}"

        system_prompt = self._build_system_prompt(task, skills_content)

        # Compact structured spec
        structured_hint = format_structured_spec(task)
        spec_context = f"\nSpec: {structured_hint[:800]}" if structured_hint else ""

        user_content = (
            f"Task: {task.get('title')}\n"
            f"Description: {task.get('description', '')}"
            f"{spec_context}"
        )

        messages = [SystemMessage(content=system_prompt), HumanMessage(content=user_content)]

        print(f"[DB] model=deepseek-v4-flash | temp=0.1 | task={task.get('title', 'N/A')}", flush=True)

        # Execute with retry on timeout OR parse failure
        max_attempts = 3
        response_content = None
        for attempt in range(max_attempts):
            try:
                response = await asyncio.wait_for(
                    self.llm.ainvoke(messages, max_tokens=6000),  # enough for large schemas
                    timeout=120
                )
                response_content = response.content if hasattr(response, 'content') else str(response)
                
                # Pre-process: escape unescaped single quotes inside JSON string values
                # to prevent JSON parse failure on SQL content like: it's, don't, schema's
                # This is done before _format_json_response which handles other strategies
            except asyncio.TimeoutError:
                print(f"[DB] Timeout attempt {attempt+1}/{max_attempts}", flush=True)
                if attempt < max_attempts - 1:
                    continue
                response_content = '{"files": [{"path": "backend/supabase/schema.sql", "content": "-- Generation timed out"}], "commands": [], "summary": "Database generation timed out"}'
                break
            except Exception as e:
                print(f"[DB] LLM error attempt {attempt+1}: {e}", flush=True)
                if attempt < max_attempts - 1:
                    continue
                response_content = f'{{"files": [{{"path": "backend/supabase/schema.sql", "content": "-- Error: {e}"}}], "commands": [], "summary": "Error: {e}"}}'
                break

            # Validate parsed JSON
            generated_json = self._format_json_response(response_content)
            
            # If parsing failed but we can see the SQL content, do a surgical extraction
            if not isinstance(generated_json, dict) or "files" not in generated_json:
                # Try extracting SQL directly from the response even if outer JSON is broken
                import re as _re
                sql_match = _re.search(
                    r'"content"\s*:\s*"((?:[^"\\]|\\[\s\S])*)"',
                    response_content,
                    _re.DOTALL
                )
                if sql_match:
                    try:
                        # Unescape the JSON string value
                        sql_content = sql_match.group(1).replace('\\"', '"').replace('\\n', '\n').replace('\\\\', '\\')
                        generated_json = {
                            "files": [{"path": "backend/supabase/schema.sql", "content": sql_content}],
                            "commands": [],
                            "summary": "Schema extracted from partial response"
                        }
                        print(f"[DB] ✓ Surgical SQL extraction succeeded ({len(sql_content)} chars)", flush=True)
                    except Exception:
                        pass
            
            if isinstance(generated_json, dict) and "files" in generated_json:
                # Extract schema_names_used and store in state for BackendAgent coordination
                schema_names = generated_json.get("schema_names_used", [])
                if not schema_names:
                    # Auto-extract from SQL content as fallback
                    import re as _re2
                    for f_item in generated_json.get("files", []):
                        sql_text = f_item.get("content", "")
                        found = _re2.findall(r"schema_name\s*=\s*['\"]([^'\"]+)['\"]", sql_text)
                        schema_names.extend(found)
                    schema_names = sorted(set(schema_names))
                if schema_names:
                    state["db_schema_names"] = schema_names
                    print(f"[DB] schema_names_used: {schema_names} → stored in state for BackendAgent", flush=True)
                    # Persist to build_contract.json so every subsequent agent can read it
                    try:
                        from Brain.shared.build_contract import record_schema_names
                        from Brain.services.workspace_manager import workspace_manager as _wm_db
                        _ws_db = _wm_db.resolve_workspace_path(
                            state.get("current_job_id"), user_id=state.get("user_id")
                        )
                        if _ws_db:
                            record_schema_names(_ws_db, schema_names)
                        else:
                            print(f"[DB] [CONTRACT] ⚠ workspace not resolved — schema_names NOT persisted to contract", flush=True)
                    except Exception as _bc_err:
                        print(f"[DB] [CONTRACT] ⚠ update failed (non-fatal): {_bc_err}", flush=True)

                # Auto-execute SQL migrations on Supabase for any .sql files generated
                for f_item in generated_json.get("files", []):
                    f_path = f_item.get("path", "")
                    f_content = f_item.get("content", "")
                    if f_path.endswith(".sql") and f_content.strip():
                        try:
                            from Brain.agents.builder.mcp_tools import supabase_exec_sql
                            print(f"[DB] 🗄 Auto-executing SQL schema '{f_path}' on Supabase database...", flush=True)
                            job_id = state.get("current_job_id")
                            sql_res = await asyncio.wait_for(
                                supabase_exec_sql.ainvoke({"sql_query": f_content}, config={"configurable": {"thread_id": job_id, "task_title": task.get("title", "")}}),
                                timeout=30
                            )
                            sql_res_str = str(sql_res).strip()
                            _sql_skipped = "live db execution skipped" in sql_res_str.lower() or sql_res_str.startswith("INFO:")
                            _sql_failed = (
                                not _sql_skipped and (
                                    sql_res_str.upper().startswith("ERROR")
                                    or "could not execute sql" in sql_res_str.lower()
                                    or any(kw in sql_res_str.lower() for kw in (
                                        "error", "failed", "exception", "invalid", "syntax error",
                                        "permission denied", "violates"
                                    ))
                                )
                            )
                            if _sql_skipped:
                                print(f"[DB] 💾 Schema saved to '{f_path}' (Local/Sandbox mode active)", flush=True)
                            elif _sql_failed:
                                print(f"[DB] [WARN] Supabase SQL execution failed — schema saved to file: {sql_res_str[:200]}", flush=True)
                                state.setdefault("db_sql_warnings", []).append({
                                    "file": f_path,
                                    "error": sql_res_str[:300],
                                })
                            else:
                                print(f"[DB] [OK] Supabase SQL executed successfully: {sql_res_str[:200]}", flush=True)
                        except asyncio.TimeoutError:
                            print(f"[DB] [WARN] Supabase SQL timed out after 30s — schema saved to file, DB may be out of sync", flush=True)
                            state.setdefault("db_sql_warnings", []).append({"file": f_path, "error": "timeout"})
                        except Exception as sql_err:
                            print(f"[DB] [WARN] Supabase SQL auto-execution error: {sql_err}", flush=True)
                            state.setdefault("db_sql_warnings", []).append({"file": f_path, "error": str(sql_err)[:200]})
                return generated_json

            # Parse failed — check if response was truncated (common with SQL content)
            is_truncated = (
                response_content and
                len(response_content) >= 5500 and  # near 6000 token limit
                not response_content.rstrip().endswith("}")
            )
            print(f"[DB] Invalid JSON (attempt {attempt+1}/{max_attempts})"
                  f"{' — response appears truncated' if is_truncated else ''}"
                  " — retrying with corrective prompt", flush=True)
            if attempt < max_attempts - 1:
                if is_truncated:
                    messages.append(SystemMessage(
                        content="Your previous response was cut off mid-JSON. "
                               "The SQL content in `content` field is too long. "
                               "SHORTEN the SQL: keep only CREATE TABLE + essential indexes + RLS policy. "
                               "Remove comments, examples, and any extra statements. "
                               "Respond ONLY with valid compact JSON under 1500 chars total:\n"
                               '{{"files": [{{"path": "backend/supabase/schema.sql", "content": "CREATE TABLE..."}}], '
                               '"commands": [], "summary": "..."}}'
                    ))
                else:
                    messages.append(SystemMessage(
                        content="Your previous response was NOT valid JSON. You MUST respond with ONLY a JSON object like: "
                               '{{"files": [{{"path": "backend/supabase/schema.sql", "content": "CREATE TABLE ..."}}], '
                               '"commands": [], "summary": "..."}}. '
                               "Do NOT include markdown, code blocks, or any text outside the JSON."
                    ))

        # All retries failed — return minimal fallback
        print(f"[DB] All {max_attempts} attempts failed, using minimal fallback", flush=True)
        return {
            "files": [{"path": "backend/supabase/schema.sql", "content": "-- Generation failed after retries"}],
            "commands": [],
            "summary": f"Database generation failed: {str(response_content)[:200]}"
        }
