"""LLM call helper: retry with backoff on 429 rate limits, then fall back to another model.

DeepInfra (Qwen models) regularly returns 429 `engine_overloaded` / "Model busy, retry later"
when a model is saturated. Without handling, every caller treats the 429 as a hard failure
and produces a fake "0 files done" task. This helper absorbs transient 429s.
"""
import asyncio


def _is_rate_limit_error(e: Exception) -> bool:
    err_str = str(e)
    if "429" in err_str:
        return True
    if "RateLimit" in type(e).__name__:
        return True
    if "engine_overloaded" in err_str or "Model busy" in err_str or "model overloaded" in err_str.lower():
        return True
    return False


async def ainvoke_with_retry(
    bound_llm,
    msgs,
    timeout: float,
    *,
    tag: str = "LLM",
    fallback_llm=None,
    max_retries: int = 3,
    backoff_base: float = 5.0,
    backoff_max: float = 60.0,
):
    """Invoke a bound LLM, transparently handling provider rate limits.

    - 429 / engine_overloaded / RateLimit errors are retried with exponential backoff.
    - If `fallback_llm` is provided, the FIRST rate limit switches to it immediately
      (a different model/provider usually has free capacity).
    - Non-rate-limit errors and timeouts are re-raised untouched (callers keep their
      existing behavior for those).
    """
    llm = bound_llm
    used_fallback = False
    retries = 0
    while True:
        try:
            return await asyncio.wait_for(llm.ainvoke(list(msgs)), timeout=timeout)
        except asyncio.TimeoutError:
            raise
        except Exception as e:
            if not _is_rate_limit_error(e):
                raise

            if not used_fallback and fallback_llm is not None:
                print(f"[{tag}] ↻ Rate limited ({str(e)[:120]}) — switching to fallback model", flush=True)
                llm = fallback_llm
                used_fallback = True
                continue

            retries += 1
            if retries > max_retries:
                raise
            wait = min(backoff_base * (2 ** (retries - 1)), backoff_max)
            print(f"[{tag}] ⚠ Rate limited (retry {retries}/{max_retries}): {str(e)[:120]} — retrying in {int(wait)}s", flush=True)
            await asyncio.sleep(wait)