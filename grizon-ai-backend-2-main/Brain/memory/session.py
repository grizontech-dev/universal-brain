import json
import asyncio
from datetime import datetime
from Brain.config.redis import redis_client

_local_session_cache = {}

class SessionMemory:
    def __init__(self, session_id: str):
        self.key = f"session:{session_id}"
        self.ttl = 24 * 60 * 60
        if self.key not in _local_session_cache:
            _local_session_cache[self.key] = {}

    async def set(self, field: str, value):
        _local_session_cache[self.key][field] = value
        try:
            await asyncio.wait_for(redis_client.hset(self.key, field, json.dumps(value)), timeout=2.0)
            await asyncio.wait_for(redis_client.expire(self.key, self.ttl), timeout=2.0)
        except Exception:
            pass

    async def get(self, field: str):
        try:
            val = await asyncio.wait_for(redis_client.hget(self.key, field), timeout=2.0)
            if val:
                return json.loads(val)
        except Exception:
            pass
        return _local_session_cache.get(self.key, {}).get(field)

    async def get_all(self) -> dict:
        try:
            all_fields = await asyncio.wait_for(redis_client.hgetall(self.key), timeout=2.0)
            if all_fields:
                return {k: json.loads(v) for k, v in all_fields.items()}
        except Exception:
            pass
        return _local_session_cache.get(self.key, {})

    async def update_workflow_state(self, state: str, agent_name: str):
        await self.set("workflow_state", state)
        await self.set("current_agent", agent_name)
        await self.set("last_active", datetime.utcnow().isoformat())

    async def clear(self):
        _local_session_cache.pop(self.key, None)
        try:
            await asyncio.wait_for(redis_client.delete(self.key), timeout=2.0)
        except Exception:
            pass
