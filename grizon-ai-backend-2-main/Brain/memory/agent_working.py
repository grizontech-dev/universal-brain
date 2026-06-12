import json
from Brain.config.redis import redis_client


class AgentWorkingMemory:
    def __init__(self, agent_name: str, session_id: str):
        self.key = f"agent_wm:{agent_name}:{session_id}"
        self.ttl = 6 * 60 * 60

    async def set(self, key: str, value):
        await redis_client.hset(self.key, key, json.dumps(value))
        await redis_client.expire(self.key, self.ttl)

    async def get(self, key: str):
        val = await redis_client.hget(self.key, key)
        return json.loads(val) if val else None

    async def get_all(self) -> dict:
        all_fields = await redis_client.hgetall(self.key)
        if not all_fields:
            return {}
        return {k: json.loads(v) for k, v in all_fields.items()}

    async def clear(self):
        await redis_client.delete(self.key)
