import os
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain_google_genai import ChatGoogleGenerativeAI
from typing import Optional

# Ensure environment variables are loaded
load_dotenv()

LOG = "[PROVIDER]"

class ProviderRouter:
    @staticmethod
    def get_model(model_id: str, temperature: float = 0.7, max_tokens: Optional[int] = None):
        """Returns the appropriate LangChain model based on the model_id."""

        # Safely get keys
        openai_key = os.getenv("OPENAI_API_KEY", "").strip() or None
        openai_base = os.getenv("OPENAI_BASE_URL", "").strip() or None
        deepseek_key = os.getenv("DEEPSEEK_API_KEY", "").strip() or None
        deepseek_base = os.getenv("DEEPSEEK_BASE_URL", "").strip() or "https://api.deepseek.com/v1"
        deepinfra_key = os.getenv("DEEPINFRA_API_KEY", "").strip() or None
        deepinfra_base = os.getenv("DEEPINFRA_BASE_URL", "").strip() or "https://api.deepinfra.com/v1/openai"
        groq_key = os.getenv("GROQ_API_KEY", "").strip() or None
        groq_base = os.getenv("GROQ_BASE_URL", "").strip() or "https://api.groq.com/openai/v1"
        openrouter_key = os.getenv("OPENROUTER_API_KEY", "").strip() or None
        openrouter_base = os.getenv("OPENROUTER_BASE_URL", "").strip() or "https://openrouter.ai/api/v1"

        # DeepInfra model IDs differ from Groq/OpenRouter style IDs
        _deepinfra_aliases = {
            "llama-4-scout-17b-16e-instruct": "meta-llama/Llama-4-Scout-17B-16E-Instruct",
        }

        def _make_openai(model: str):
            return ChatOpenAI(
                model=model,
                api_key=openai_key,
                base_url=openai_base,
                temperature=temperature,
                max_retries=1,
                timeout=90,
                request_timeout=90,
                **({"max_tokens": max_tokens} if max_tokens else {})
            )

        def _make_deepseek(model: str):
            # Enable thinking mode for deepseek-v4-pro (reasoning model)
            extra = {}
            if "v4-pro" in model.lower():
                extra["extra_body"] = {"thinking": {"type": "enabled"}}
                print(f"{LOG} → Thinking mode ENABLED for {model}", flush=True)
            return ChatOpenAI(
                model=model,
                api_key=deepseek_key,
                base_url=deepseek_base,
                temperature=temperature,
                max_retries=1,
                timeout=90,
                request_timeout=90,
                **({"max_tokens": max_tokens} if max_tokens else {}),
                **extra
            )

        def _make_deepinfra(model: str):
            extra = {}
            return ChatOpenAI(
                model=model,
                api_key=deepinfra_key,
                base_url=deepinfra_base,
                temperature=temperature,
                max_retries=1,
                timeout=120,
                request_timeout=120,
                **({"max_tokens": max_tokens} if max_tokens else {}),
                **extra,
            )

        def _make_openrouter(model: str):
            extra_headers = {
                "HTTP-Referer": "https://grizon.ai",
                "X-Title": "Grizon AI",
            }
            return ChatOpenAI(
                model=model,
                api_key=openrouter_key,
                base_url=openrouter_base,
                temperature=temperature,
                streaming=True,
                default_headers=extra_headers,
                max_retries=1,
                timeout=120,
                request_timeout=120,
                **({"max_tokens": max_tokens} if max_tokens else {})
            )

        # Decide the universal fallback — DeepSeek first, then OpenAI
        def get_fallback_model():
            if deepseek_key:
                print(f"{LOG} Fallback → DeepSeek 'deepseek-chat' (base={deepseek_base})", flush=True)
                return _make_deepseek("deepseek-chat")
            print(f"{LOG} Fallback → OpenAI 'gpt-4o' (base={openai_base or 'default'})", flush=True)
            return _make_openai("gpt-4o")

        # Handle UUIDs/Database IDs by defaulting to fallback
        is_known_id = any(prefix in model_id.lower() for prefix in ["gpt", "claude", "gemini", "grok", "llama", "deepseek", "kimi", "deepinfra", "qwen", "gemma", "openrouter"])

        print(f"{LOG} get_model(id='{model_id}', temp={temperature}) | known={is_known_id}", flush=True)

        # DeepSeek Models — primary provider
        if "deepseek" in model_id.lower():
            if deepseek_key:
                print(f"{LOG} → DeepSeek '{model_id}' (base={deepseek_base})", flush=True)
                return _make_deepseek(model_id)
            return get_fallback_model()

        # Qwen / OpenRouter / Google OpenRouter Models -> OpenRouter
        elif "qwen" in model_id.lower() or "openrouter" in model_id.lower() or "google/" in model_id.lower():
            if openrouter_key:
                print(f"{LOG} → OpenRouter '{model_id}' (base={openrouter_base})", flush=True)
                return _make_openrouter(model_id)
            return get_fallback_model()

        # DeepInfra Models
        elif "deepinfra" in model_id.lower():
            if deepinfra_key:
                print(f"{LOG} → DeepInfra '{model_id}' (base={deepinfra_base})", flush=True)
                return _make_deepinfra(model_id)
            return get_fallback_model()

        # Kimi Models (OpenAI-compatible API) — only temperature=1 allowed
        elif "kimi" in model_id.lower():
            kimi_key = os.getenv("KIMI_API_KEY", "").strip() or openai_key
            kimi_base = os.getenv("KIMI_BASE_URL", "").strip() or "https://api.moonshot.cn/v1"
            if kimi_key:
                print(f"{LOG} → Kimi '{model_id}' (base={kimi_base}, temp=1 forced)", flush=True)
                return ChatOpenAI(
                    model=model_id,
                    api_key=kimi_key,
                    base_url=kimi_base,
                    temperature=1,
                    max_retries=1,
                    timeout=90,
                    request_timeout=90,
                    **({"max_tokens": max_tokens} if max_tokens else {})
                )
            return get_fallback_model()

        # Llama Models — prefer OpenRouter (most reliable, handles load balancing),
        # else Groq (fastest but strict rate limits), else DeepInfra, else fallback
        elif "llama" in model_id.lower():
            # Map short IDs to full OpenRouter model strings
            _openrouter_llama_aliases = {
                "llama-4-scout-17b-16e-instruct": "meta-llama/llama-4-scout",
                "llama-4-scout": "meta-llama/llama-4-scout",
                "llama-4-maverick": "meta-llama/llama-4-maverick",
                "llama-3.3-70b": "meta-llama/llama-3.3-70b-instruct",
                "llama-3.1-8b": "meta-llama/llama-3.1-8b-instruct",
            }
            if openrouter_key:
                or_model = _openrouter_llama_aliases.get(model_id.lower(), f"meta-llama/{model_id}")
                print(f"{LOG} → OpenRouter '{or_model}' (base={openrouter_base})", flush=True)
                return _make_openrouter(or_model)
            if groq_key:
                print(f"{LOG} → Groq '{model_id}' (base={groq_base})", flush=True)
                return ChatOpenAI(
                    model=model_id,
                    api_key=groq_key,
                    base_url=groq_base,
                    temperature=temperature,
                    max_retries=1,
                    timeout=90,
                    request_timeout=90,
                    **({"max_tokens": max_tokens} if max_tokens else {})
                )
            if deepinfra_key:
                target = _deepinfra_aliases.get(model_id, model_id)
                print(f"{LOG} → DeepInfra '{target}' (base={deepinfra_base})", flush=True)
                return _make_deepinfra(target)
            print(f"{LOG} → Llama '{model_id}' — no OpenRouter/Groq/DeepInfra key → fallback", flush=True)
            return get_fallback_model()

        # Claude Models or Unknown IDs - Fallback
        elif "claude" in model_id.lower() or not is_known_id:
            print(f"{LOG} → Claude/Unknown '{model_id}' → fallback", flush=True)
            model = get_fallback_model()

        # GPT Models
        elif "gpt" in model_id.lower():
            if openai_key:
                print(f"{LOG} → OpenAI '{model_id}' (base={openai_base or 'default'})", flush=True)
                model = _make_openai(model_id)
            else:
                model = get_fallback_model()

        # Gemini Models
        elif "gemini" in model_id or "gemma" in model_id:
            gemini_key = os.getenv("GOOGLE_AI_API_KEY", "").strip() or None
            if gemini_key:
                # Map model names to actual API model IDs
                if "gemma-4-26b" in model_id:
                    actual_model = "gemma-4-26b-a4b-it"
                elif "gemma-4-31b" in model_id:
                    actual_model = "gemma-4-31b-it"
                elif "gemma" in model_id:
                    actual_model = "gemma-4-26b-a4b-it"
                elif "2.5-flash-lite" in model_id:
                    actual_model = "gemini-2.5-flash-lite"
                elif "2.5-flash" in model_id:
                    actual_model = "gemini-2.5-flash"
                elif "2.5-pro" in model_id:
                    actual_model = "gemini-2.5-pro"
                elif "2.0-flash-lite" in model_id:
                    actual_model = "gemini-2.0-flash-lite"
                elif "2.0-flash" in model_id:
                    actual_model = "gemini-2.0-flash"
                elif "flash" in model_id:
                    actual_model = "gemini-2.5-flash-lite"
                elif "pro" in model_id:
                    actual_model = "gemini-2.5-pro"
                else:
                    actual_model = "gemini-3-flash-preview"
                print(f"{LOG} → Gemini '{actual_model}'", flush=True)
                model = ChatGoogleGenerativeAI(
                    model=actual_model,
                    google_api_key=gemini_key,
                    temperature=temperature,
                    convert_system_message_to_human=True,
                    max_retries=1,
                    timeout=60,
                    request_timeout=60,
                    **({"max_output_tokens": max_tokens} if max_tokens else {})
                )
            else:
                model = get_fallback_model()

        # xAI Models - Redirected to fallback
        elif "grok" in model_id or "xai" in model_id:
            print(f"{LOG} → Grok/xAI '{model_id}' → fallback", flush=True)
            model = get_fallback_model()

        # Default fallback
        else:
            print(f"{LOG} → Default fallback for '{model_id}'", flush=True)
            model = get_fallback_model()

        from Brain.utils.token_counter import TokenCounterCallbackHandler
        model.callbacks = (model.callbacks or []) + [TokenCounterCallbackHandler()]
        return model
