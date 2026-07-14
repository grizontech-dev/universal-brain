import json
import asyncio
from datetime import datetime
from Brain.config.redis import redis_client

class SessionMemory:
    def __init__(self, session_id: str):
        self.key = f"session:{session_id}"
        self.ttl = 24 * 60 * 60

    async def set(self, field: str, value):
        try:
            await asyncio.wait_for(redis_client.hset(self.key, field, json.dumps(value)), timeout=5.0)
            await asyncio.wait_for(redis_client.expire(self.key, self.ttl), timeout=5.0)
        except Exception as e:
            print(f"[SessionMemory] Redis error on set: {e}", flush=True)

    async def get(self, field: str):
        try:
            val = await asyncio.wait_for(redis_client.hget(self.key, field), timeout=5.0)
            return json.loads(val) if val else None
        except Exception as e:
            print(f"[SessionMemory] Redis error on get: {e}", flush=True)
            return None

    async def get_all(self) -> dict:
        try:
            all_fields = await asyncio.wait_for(redis_client.hgetall(self.key), timeout=5.0)
            return {k: json.loads(v) for k, v in all_fields.items()}
        except Exception as e:
            print(f"[SessionMemory] Redis error on get_all: {e}", flush=True)
            return {}

    async def update_workflow_state(self, state: str, agent_name: str):
        await self.set("workflow_state", state)
        await self.set("current_agent", agent_name)
        await self.set("last_active", datetime.utcnow().isoformat())

    async def clear(self):
        try:
            await asyncio.wait_for(redis_client.delete(self.key), timeout=5.0)
        except Exception as e:
            print(f"[SessionMemory] Redis error on clear: {e}", flush=True)
