import os
import asyncio
import json
from typing import Any, Dict, List, Optional
from abc import ABC, abstractmethod
from Brain.services.provider_router import ProviderRouter
from langchain_core.messages import HumanMessage, SystemMessage, BaseMessage
from langchain_core.language_models.chat_models import BaseChatModel

LOG = "[BASE_AGENT]"

class BaseAgent(ABC):
    def __init__(self, name: str, description: str, model_id: Optional[str] = None):
        self.name = name
        self.description = description
        self.model_id = model_id or os.getenv("DEFAULT_CHEAP_MODEL", "deepseek-v4-pro")
        self._model: Optional[BaseChatModel] = None

    def get_model(self, model_id: Optional[str] = None, temperature: float = 0.3, max_tokens: Optional[int] = None) -> BaseChatModel:
        """Returns the model instance, cached if possible."""
        target_model = model_id or self.model_id
        return ProviderRouter.get_model(target_model, temperature=temperature, max_tokens=max_tokens)

    async def chat(self, messages: List[BaseMessage], model_id: Optional[str] = None, temperature: float = 0.3, timeout: float = 90, max_tokens: Optional[int] = None) -> str:
        """Generic chat method for interacting with the LLM."""
        model = self.get_model(model_id, temperature, max_tokens=max_tokens)
        target_model_id = model_id or self.model_id
        print(f"{LOG} [{self.name}] chat() | model={target_model_id} | timeout={timeout}s | msgs={len(messages)}", flush=True)
        try:
            import time as _t
            _t0 = _t.time()
            print(f"{LOG} [{self.name}] → ainvoke starting...", flush=True)
            response = await asyncio.wait_for(model.ainvoke(messages), timeout=timeout)
            print(f"{LOG} [{self.name}] ← ainvoke done in {_t.time()-_t0:.1f}s", flush=True)
        except asyncio.TimeoutError:
            print(f"{LOG} [{self.name}] ✖ LLM TIMEOUT after {timeout}s", flush=True)
            return '{"error": "LLM call timed out"}'
        except Exception as e:
            print(f"{LOG} [{self.name}] ✖ LLM ERROR: {type(e).__name__}: {e}", flush=True)
            return '{"error": "LLM call failed"}'
        content = response.content
        if isinstance(content, list):
            # Handle multi-part messages by joining string parts
            content = " ".join([str(p.get("text", p)) if isinstance(p, dict) else str(p) for p in content])
        
        # Log a snippet of the raw response
        snippet = str(content)[:200].replace('\n', ' ')
        print(f"{LOG} [{self.name}] ← response: {len(str(content))} chars | preview='{snippet}'", flush=True)
        
        return str(content)

    def _repair_json(self, s: str) -> str:
        """Sanitize malformed JSON: handle unescaped quotes/backslashes/newlines in strings."""
        result = []
        in_string = False
        escaped = False
        i = 0
        while i < len(s):
            ch = s[i]
            if in_string:
                if escaped:
                    if ch == '"' or ch == '\\' or ch == '/' or ch == 'b' or ch == 'f' or ch == 'n' or ch == 'r' or ch == 't' or ch == 'u':
                        result.append('\\' + ch)
                    elif ch in '\n\r\t':
                        result.append('\\n' if ch == '\n' else '\\r' if ch == '\r' else '\\t')
                    else:
                        result.append('\\\\' + ch)
                    escaped = False
                elif ch == '\\':
                    escaped = True
                    # Don't append yet — wait for next char
                elif ch == '"':
                    # Look ahead: valid string terminator if followed by , : } ] or EOF
                    j = i + 1
                    while j < len(s) and s[j] in ' \t\n\r':
                        j += 1
                    if j >= len(s) or s[j] in ',:}]':
                        in_string = False
                        result.append('"')
                    else:
                        result.append('\\"')
                elif ch in '\n\r\t':
                    result.append('\\n' if ch == '\n' else '\\r' if ch == '\r' else '\\t')
                else:
                    result.append(ch)
            else:
                if ch == '"':
                    in_string = True
                result.append(ch)
            i += 1
        return ''.join(result)

    def _format_json_response(self, content: str) -> Dict[str, Any]:
        """Highly resilient JSON parser that handles markdown, extra text, and truncation."""
        import re
        if not content or not isinstance(content, str):
            print(f"{LOG} [{self.name}] ✖ JSON parse: empty or non-string response", flush=True)
            return {"error": "Empty or non-string response from agent"}

        # Strategy 1: Look for JSON within markdown code blocks
        blocks = re.findall(r'```(?:json)?\s*([\s\S]*?)\s*```', content)
        for i, block in enumerate(blocks):
            try:
                return json.loads(block.strip(), strict=False)
            except Exception as e:
                print(f"DEBUG: Strategy 1 (code block {i}) JSON parsing failed: {e}")
                # Try repairing before giving up on this block
                try:
                    repaired = self._repair_json(block.strip())
                    return json.loads(repaired, strict=False)
                except Exception as e2:
                    print(f"DEBUG: Strategy 1 repair attempt also failed: {e2}")
                    continue

        # Strategy 2: Look for the outermost { } or [ ]
        try:
            start_idx = min(content.find('{') if '{' in content else float('inf'), 
                           content.find('[') if '[' in content else float('inf'))
            end_idx = max(content.rfind('}') if '}' in content else -1, 
                         content.rfind(']') if ']' in content else -1)
            
            if start_idx != float('inf') and end_idx != -1 and end_idx > start_idx:
                json_candidate = content[int(start_idx):end_idx + 1]
                try:
                    return json.loads(json_candidate, strict=False)
                except Exception as e:
                    print(f"DEBUG: Strategy 2 JSON parsing failed: {e}")
                    try:
                        repaired = self._repair_json(json_candidate)
                        return json.loads(repaired, strict=False)
                    except Exception as e2:
                        print(f"DEBUG: Strategy 2 repair attempt also failed: {e2}")
        except Exception as e:
            print(f"DEBUG: Strategy 2 preparation failed: {e}")

        # Strategy 3: Just try to load the whole thing stripped
        try:
            return json.loads(content.strip(), strict=False)
        except Exception as e:
            print(f"CRITICAL: All JSON parsing strategies failed for agent {self.name}: {e}")
            # Final attempt: handle common truncation
            stripped = content.strip()
            if stripped.startswith('{') and not stripped.endswith('}'):
                try: 
                    return json.loads(stripped + '}', strict=False)
                except Exception as final_e: 
                    print(f"DEBUG: Final truncation repair strategy failed: {final_e}")
            # Last-ditch: repair + close
            try:
                repaired = self._repair_json(stripped)
                if repaired.startswith('{') and not repaired.endswith('}'):
                    repaired += '}'
                return json.loads(repaired, strict=False)
            except Exception as final_e2:
                print(f"DEBUG: Last-ditch repair also failed: {final_e2}")
            
            return {"status": "error", "summary": f"Failed to parse JSON: {e}", "raw": content[:500]}

    @abstractmethod
    async def execute(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """The main execution logic for the agent."""
        pass
