import json
from datetime import datetime
from Brain.config.redis import redis_client


class SessionMemory:
    def __init__(self, session_id: str):
        self.key = f"session:{session_id}"
        self.ttl = 24 * 60 * 60

    async def set(self, field: str, value):
        await redis_client.hset(self.key, field, json.dumps(value))
        await redis_client.expire(self.key, self.ttl)

    async def get(self, field: str):
        val = await redis_client.hget(self.key, field)
        return json.loads(val) if val else None

    async def get_all(self) -> dict:
        all_fields = await redis_client.hgetall(self.key)
        return {k: json.loads(v) for k, v in all_fields.items()}

    async def update_workflow_state(self, state: str, agent_name: str):
        await self.set("workflow_state", state)
        await self.set("current_agent", agent_name)
        await self.set("last_active", datetime.utcnow().isoformat())

    async def clear(self):
        await redis_client.delete(self.key)
