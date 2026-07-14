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
        
        # Decide the universal fallback model/provider
        fallback_provider = "openai"
        fallback_model = "gpt-4o"
            
        def get_fallback_model():
            print(f"{LOG} Fallback → OpenAI '{fallback_model}' (base={openai_base or 'default'})", flush=True)
            return ChatOpenAI(
                model=fallback_model,
                api_key=openai_key,
                base_url=openai_base,
                temperature=temperature,
                max_retries=2,
                **({"max_tokens": max_tokens} if max_tokens else {})
            )

        # Handle UUIDs/Database IDs by defaulting to fallback
        is_known_id = any(prefix in model_id.lower() for prefix in ["gpt", "claude", "gemini", "grok", "llama"])
        
        print(f"{LOG} get_model(id='{model_id}', temp={temperature}) | known={is_known_id}", flush=True)
        
        # Claude Models or Unknown IDs - Fallback
        if "claude" in model_id.lower() or not is_known_id:
            print(f"{LOG} → Claude/Unknown '{model_id}' → fallback", flush=True)
            return get_fallback_model()
        
        # GPT Models - Prefer low-cost OpenAI if available, else fallback
        elif "gpt" in model_id.lower():
            if openai_key:
                print(f"{LOG} → OpenAI '{model_id}' (base={openai_base or 'default'})", flush=True)
                return ChatOpenAI(
                    model=model_id,
                    api_key=openai_key,
                    base_url=openai_base,
                    temperature=temperature,
                    max_retries=2,
                    **({"max_tokens": max_tokens} if max_tokens else {})
                )
            return get_fallback_model()
        
        # Gemini Models
        elif "gemini" in model_id:
            gemini_key = os.getenv("GOOGLE_AI_API_KEY", "").strip() or None
            if gemini_key:
                if "3-flash" in model_id or "flash" in model_id:
                    actual_model = "gemini-3-flash-preview"
                elif "pro" in model_id:
                    actual_model = "gemini-2.0-pro"
                else:
                    actual_model = "gemini-3-flash-preview"
                print(f"{LOG} → Gemini '{actual_model}'", flush=True)
                return ChatGoogleGenerativeAI(
                    model=actual_model,
                    google_api_key=gemini_key,
                    temperature=temperature,
                    convert_system_message_to_human=True,
                    max_retries=1,
                    timeout=30,
                    request_timeout=30,
                    **({"max_output_tokens": max_tokens} if max_tokens else {})
                )
            return get_fallback_model()
        
        # GPT Models - Redirected to OpenAI
        elif "deepseek" in model_id:
            print(f"{LOG} → DeepSeek '{model_id}' → fallback", flush=True)
            return get_fallback_model()
            
        # xAI Models - Redirected to fallback
        elif "grok" in model_id or "xai" in model_id:
            print(f"{LOG} → Grok/xAI '{model_id}' → fallback", flush=True)
            return get_fallback_model()
            
        # Default fallback
        else:
            print(f"{LOG} → Default fallback for '{model_id}'", flush=True)
            return get_fallback_model()
