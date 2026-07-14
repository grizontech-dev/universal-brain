import json
import asyncio
from Brain.config.redis import redis_client

class AgentWorkingMemory:
    def __init__(self, agent_name: str, session_id: str):
        self.key = f"agent_wm:{agent_name}:{session_id}"
        self.ttl = 6 * 60 * 60

    async def set(self, key: str, value):
        try:
            await asyncio.wait_for(redis_client.hset(self.key, key, json.dumps(value)), timeout=5.0)
            await asyncio.wait_for(redis_client.expire(self.key, self.ttl), timeout=5.0)
        except Exception as e:
            print(f"[AgentWorkingMemory] Failed to set memory due to Redis error: {e}", flush=True)

    async def get(self, key: str):
        try:
            val = await asyncio.wait_for(redis_client.hget(self.key, key), timeout=5.0)
            return json.loads(val) if val else None
        except Exception as e:
            print(f"[AgentWorkingMemory] Failed to get memory due to Redis error: {e}", flush=True)
            return None

    async def get_all(self) -> dict:
        try:
            all_fields = await asyncio.wait_for(redis_client.hgetall(self.key), timeout=5.0)
            if not all_fields:
                return {}
            return {k: json.loads(v) for k, v in all_fields.items()}
        except Exception as e:
            print(f"[AgentWorkingMemory] Failed to get_all memory due to Redis error: {e}", flush=True)
            return {}

    async def clear(self):
        try:
            await asyncio.wait_for(redis_client.delete(self.key), timeout=5.0)
        except Exception as e:
            print(f"[AgentWorkingMemory] Failed to clear memory due to Redis error: {e}", flush=True)
