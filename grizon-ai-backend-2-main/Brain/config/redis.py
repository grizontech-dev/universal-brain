import os
import asyncio
import redis.asyncio as aioredis
import logging

logger = logging.getLogger("brain.redis")

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
_redis_healthy = False


class ResilientRedisClient:
    """Wrapper around redis.asyncio that silently degrades when Redis is unreachable."""

    def __init__(self, url: str):
        self._url = url
        self._client = None
        self._healthy = False
        self._last_fail_ts = 0.0
        self._fail_backoff = 30

    async def _get_client(self):
        if self._client is None:
            import time as _t
            if self._last_fail_ts and (_t.time() - self._last_fail_ts) < self._fail_backoff:
                return None
            try:
                self._client = aioredis.from_url(
                    self._url,
                    decode_responses=True,
                    socket_connect_timeout=3,
                    socket_timeout=5,
                    retry_on_timeout=False,
                    max_connections=20,
                )
                await self._client.ping()
                self._healthy = True
                logger.info("Redis connected at %s", self._url)
            except Exception as e:
                self._healthy = False
                self._last_fail_ts = _t.time()
                logger.warning("Redis unavailable (%s) — memory features disabled (retrying in %ss)", e, self._fail_backoff)
                return None
        return self._client

    @property
    def is_healthy(self):
        return self._healthy

    # --- Hash ops ---
    async def hset(self, name, key, value):
        c = await self._get_client()
        if c:
            try:
                return await c.hset(name, key, value)
            except Exception:
                return None
        return None

    async def hget(self, name, key):
        c = await self._get_client()
        if c:
            try:
                return await c.hget(name, key)
            except Exception:
                return None
        return None

    async def hgetall(self, name):
        c = await self._get_client()
        if c:
            try:
                return await c.hgetall(name)
            except Exception:
                return {}
        return {}

    # --- String ops ---
    async def set(self, name, value, ex=None):
        c = await self._get_client()
        if c:
            try:
                if ex:
                    return await c.setex(name, ex, value)
                return await c.set(name, value)
            except Exception:
                return None
        return None

    async def setex(self, name, time, value):
        c = await self._get_client()
        if c:
            try:
                return await c.setex(name, time, value)
            except Exception:
                return None
        return None

    async def get(self, name):
        c = await self._get_client()
        if c:
            try:
                return await c.get(name)
            except Exception:
                return None
        return None

    async def incr(self, name):
        c = await self._get_client()
        if c:
            try:
                return await c.incr(name)
            except Exception:
                return 0
        return 0

    # --- List ops ---
    async def lpush(self, name, *values):
        c = await self._get_client()
        if c:
            try:
                return await c.lpush(name, *values)
            except Exception:
                return None
        return None

    async def lrange(self, name, start, end):
        c = await self._get_client()
        if c:
            try:
                return await c.lrange(name, start, end)
            except Exception:
                return []
        return []

    # --- Set ops ---
    async def sadd(self, name, *values):
        c = await self._get_client()
        if c:
            try:
                return await c.sadd(name, *values)
            except Exception:
                return None
        return None

    async def srem(self, name, *values):
        c = await self._get_client()
        if c:
            try:
                return await c.srem(name, *values)
            except Exception:
                return None
        return None

    async def smembers(self, name):
        c = await self._get_client()
        if c:
            try:
                return await c.smembers(name)
            except Exception:
                return set()
        return set()

    # --- Key ops ---
    async def expire(self, name, time):
        c = await self._get_client()
        if c:
            try:
                return await c.expire(name, time)
            except Exception:
                return None
        return None

    async def delete(self, *names):
        c = await self._get_client()
        if c:
            try:
                return await c.delete(*names)
            except Exception:
                return None
        return None

    # --- Ping ---
    async def ping(self):
        c = await self._get_client()
        if c:
            try:
                return await c.ping()
            except Exception:
                return False
        return False


redis_client = ResilientRedisClient(REDIS_URL)
