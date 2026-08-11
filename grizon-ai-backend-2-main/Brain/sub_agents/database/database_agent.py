from typing import Any, Dict
import asyncio
from Brain.shared.agent import BaseAgent
from Brain.shared.build_standards import DATABASE_BUILD_STANDARDS
from Brain.shared.skills.resolver import SkillResolver
from Brain.shared.structured_spec import format_structured_spec
from Brain.services.provider_router import ProviderRouter
from langchain_core.messages import SystemMessage, HumanMessage


class DatabaseAgent(BaseAgent):
    _skill_cache = {}

    def __init__(self):
        super().__init__(
            name="Database Agent",
            description="Specialized in company-owned Supabase schema design and MCP connectors.",
            model_id="deepseek-v4-flash"
        )
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
        prompt = f"""You are the Database Agent for Grizon Brain. Supabase schema design.

{DATABASE_BUILD_STANDARDS}

SKILL FILES (reference only):
{skills_content}

═══ RULES ═══
1. Output SQL in `backend/supabase/schema.sql` or `backend/supabase/migrations/*.sql` only.
2. Shared tenant-scoped table with JSONB: tenant_id, entity_type, entity_key, payload_jsonb, metadata_jsonb.
3. Include RLS policies, tenant filters, JSONB GIN indexes.
4. Keep schemas compact (500 MB free-tier limit).
5. NEVER output user Supabase credentials. Server-side only.
6. NEVER: Supabase CLI, echo commands, npm install.
7. commands: always [].

═══ OUTPUT FORMAT ═══
Respond ONLY in JSON.
{{"files": [{{"path": "backend/supabase/...", "content": "..."}}, ...], "commands": [], "summary": "..."}}
"""
        return prompt

    async def execute(self, current_task: Dict[str, Any], state: Dict[str, Any]) -> Dict[str, Any]:
        task = current_task
        task_description = f"{task.get('title', '')} {task.get('description', '')}"

        # Skill resolution with granular caching — DB tasks are never simple
        cache_key = self._get_skill_cache_key(task, task_description)
        if cache_key in DatabaseAgent._skill_cache:
            skills_content = DatabaseAgent._skill_cache[cache_key]
            print(f"[DB] Using cached skills: {cache_key}", flush=True)
        else:
            try:
                skills_content = self.skill_resolver.resolve_skills_for_task(task_description)
                DatabaseAgent._skill_cache[cache_key] = skills_content
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
                    self.llm.ainvoke(messages, max_tokens=8192),
                    timeout=120
                )
                response_content = response.content if hasattr(response, 'content') else str(response)
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
            if isinstance(generated_json, dict) and "files" in generated_json:
                return generated_json

            # Parse failed — retry with corrective prompt
            print(f"[DB] Invalid JSON (attempt {attempt+1}/{max_attempts}) — retrying with corrective prompt", flush=True)
            if attempt < max_attempts - 1:
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
