import json
import asyncio
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
        try:
            await asyncio.wait_for(redis_client.lpush(self.key, entry), timeout=5.0)
            await asyncio.wait_for(redis_client.expire(self.key, self.ttl), timeout=5.0)
        except Exception as e:
            print(f"[ShortTermMemory] Redis error on append: {type(e).__name__}: {e}", flush=True)

    async def get_recent(self, limit: int = 20) -> list:
        try:
            raw = await asyncio.wait_for(redis_client.lrange(self.key, 0, limit - 1), timeout=5.0)
            entries = [json.loads(r) for r in raw]
            entries.reverse()
            return entries
        except Exception as e:
            print(f"[ShortTermMemory] Redis error on get_recent: {e}", flush=True)
            return []

    async def clear(self):
        try:
            await asyncio.wait_for(redis_client.delete(self.key), timeout=5.0)
        except Exception as e:
            print(f"[ShortTermMemory] Redis error on clear: {e}", flush=True)
