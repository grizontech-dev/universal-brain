import json
from datetime import datetime
from Brain.config.redis import redis_client


class ShortTermMemory:
    def __init__(self, session_id: str):
        self.key = f"short_term:{session_id}"
        self.ttl = 3 * 60 * 60

    async def append(self, role: str, content: str, agent: str = None):
        entry = json.dumps({
            "role": role,
            "content": content,
            "agent": agent,
            "timestamp": datetime.utcnow().isoformat()
        })
        await redis_client.lpush(self.key, entry)
        await redis_client.expire(self.key, self.ttl)

    async def get_recent(self, limit: int = 20) -> list:
        raw = await redis_client.lrange(self.key, 0, limit - 1)
        entries = [json.loads(r) for r in raw]
        entries.reverse()
        return entries

    async def clear(self):
        await redis_client.delete(self.key)
