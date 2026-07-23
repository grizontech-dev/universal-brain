import os
from dotenv import load_dotenv
from langchain_anthropic import ChatAnthropic
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

        def _make_openai(model: str):
            return ChatOpenAI(
                model=model,
                api_key=openai_key,
                base_url=openai_base,
                temperature=temperature,
                max_retries=2,
                timeout=120,
                request_timeout=120,
                **({"max_tokens": max_tokens} if max_tokens else {})
            )

        def _make_deepseek(model: str):
            return ChatOpenAI(
                model=model,
                api_key=deepseek_key,
                base_url=deepseek_base,
                temperature=temperature,
                max_retries=2,
                timeout=120,
                request_timeout=120,
                **({"max_tokens": max_tokens} if max_tokens else {})
            )

        # Decide the universal fallback — DeepSeek first, then OpenAI
        def get_fallback_model():
            if deepseek_key:
                print(f"{LOG} Fallback → DeepSeek 'deepseek-v4-pro' (base={deepseek_base})", flush=True)
                return _make_deepseek("deepseek-v4-pro")
            print(f"{LOG} Fallback → OpenAI 'gpt-4o' (base={openai_base or 'default'})", flush=True)
            return _make_openai("gpt-4o")

        # Handle UUIDs/Database IDs by defaulting to fallback
        is_known_id = any(prefix in model_id.lower() for prefix in ["gpt", "claude", "gemini", "grok", "llama", "deepseek"])

        print(f"{LOG} get_model(id='{model_id}', temp={temperature}) | known={is_known_id}", flush=True)

        # DeepSeek Models — primary provider
        if "deepseek" in model_id.lower():
            if deepseek_key:
                print(f"{LOG} → DeepSeek '{model_id}' (base={deepseek_base})", flush=True)
                return _make_deepseek(model_id)
            return get_fallback_model()

        # Claude Models or Unknown IDs - Fallback
        elif "claude" in model_id.lower() or not is_known_id:
            print(f"{LOG} → Claude/Unknown '{model_id}' → fallback", flush=True)
            return get_fallback_model()

        # GPT Models
        elif "gpt" in model_id.lower():
            if openai_key:
                print(f"{LOG} → OpenAI '{model_id}' (base={openai_base or 'default'})", flush=True)
                return _make_openai(model_id)
            return get_fallback_model()

        # Gemini Models
        elif "gemini" in model_id:
            gemini_key = os.getenv("GOOGLE_AI_API_KEY", "").strip() or None
            if gemini_key:
                # Map model names to actual API model IDs
                if "2.5-flash-lite" in model_id:
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
                    actual_model = "gemini-2.5-flash-lite"
                print(f"{LOG} → Gemini '{actual_model}'", flush=True)
                return ChatGoogleGenerativeAI(
                    model=actual_model,
                    google_api_key=gemini_key,
                    temperature=temperature,
                    convert_system_message_to_human=True,
                    max_retries=2,
                    timeout=60,
                    request_timeout=60,
                    **({"max_output_tokens": max_tokens} if max_tokens else {})
                )
            return get_fallback_model()

        # xAI Models - Redirected to fallback
        elif "grok" in model_id or "xai" in model_id:
            print(f"{LOG} → Grok/xAI '{model_id}' → fallback", flush=True)
            return get_fallback_model()

        # Default fallback
        else:
            print(f"{LOG} → Default fallback for '{model_id}'", flush=True)
            return get_fallback_model()
