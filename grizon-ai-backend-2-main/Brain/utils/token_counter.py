import math
from contextvars import ContextVar
from typing import Dict, Optional, Generator
from contextlib import contextmanager
from langchain_core.callbacks import BaseCallbackHandler

# ContextVar storing a dictionary of token counts, e.g. {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
token_counter_var: ContextVar[Optional[Dict[str, int]]] = ContextVar("token_counter", default=None)

class TokenCounterCallbackHandler(BaseCallbackHandler):
    """
    A LangChain callback handler that counts input and output tokens
    using the active ContextVar if set.
    """
    def on_llm_end(self, response, **kwargs) -> None:
        try:
            tokens_data = token_counter_var.get(None)
            if tokens_data is None:
                return

            for generation in response.generations:
                for g in generation:
                    # Try usage_metadata first (supported in newer LangChain versions)
                    if hasattr(g, 'message') and hasattr(g.message, 'usage_metadata'):
                        meta = g.message.usage_metadata
                        if meta:
                            tokens_data["input_tokens"] += meta.get('input_tokens', 0)
                            tokens_data["output_tokens"] += meta.get('output_tokens', 0)
                            tokens_data["total_tokens"] += meta.get('total_tokens', 0)
                            continue
                    
                    # Fallback to response_metadata
                    if hasattr(g, 'message') and hasattr(g.message, 'response_metadata'):
                        meta = g.message.response_metadata
                        token_usage = meta.get('token_usage')
                        if token_usage:
                            tokens_data["input_tokens"] += token_usage.get('prompt_tokens', 0)
                            tokens_data["output_tokens"] += token_usage.get('completion_tokens', 0)
                            tokens_data["total_tokens"] += token_usage.get('total_tokens', 0)
                        elif 'usage' in meta: # alternate format
                            usage = meta['usage']
                            tokens_data["input_tokens"] += usage.get('prompt_tokens', 0)
                            tokens_data["output_tokens"] += usage.get('completion_tokens', 0)
                            tokens_data["total_tokens"] += usage.get('total_tokens', 0)
        except Exception as e:
            print(f"ERROR: TokenCounterCallbackHandler failed to record tokens: {e}")

@contextmanager
def token_counter_context() -> Generator[Dict[str, int], None, None]:
    """
    Context manager to wrap a section of code and collect all tokens
    consumed during its execution.
    """
    tokens_data = {
        "input_tokens": 0,
        "output_tokens": 0,
        "total_tokens": 0
    }
    token = token_counter_var.set(tokens_data)
    try:
        yield tokens_data
    finally:
        token_counter_var.reset(token)

def get_cumulative_tokens() -> Optional[Dict[str, int]]:
    """Returns the current active token counter data dictionary, if any."""
    return token_counter_var.get(None)

def calculate_credits(total_tokens: int) -> int:
    """
    Calculate credit cost from token count.
    Formula: 1 credit for every 4,000 tokens consumed, rounded up.
    """
    if total_tokens <= 0:
        return 0
    return math.ceil(total_tokens / 4000.0)
