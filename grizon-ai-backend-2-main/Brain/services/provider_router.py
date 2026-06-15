import os
from dotenv import load_dotenv
from langchain_anthropic import ChatAnthropic
from langchain_openai import ChatOpenAI
from langchain_google_genai import ChatGoogleGenerativeAI
from typing import Optional

# Ensure environment variables are loaded
load_dotenv()

class ProviderRouter:
    @staticmethod
    def get_model(model_id: str, temperature: float = 0.7):
        """Returns the appropriate LangChain model based on the model_id."""
        
        # Safely get keys
        deepseek_key = os.getenv("DEEPSEEK_API_KEY", "").strip() or None
        openai_key = os.getenv("OPENAI_API_KEY", "").strip() or None
        openai_base = os.getenv("OPENAI_BASE_URL", "").strip() or None
        
        # Decide the universal fallback model/provider
        if openai_key:
            fallback_provider = "openai"
            fallback_model = "gpt-4o"
        else:
            fallback_provider = "deepseek"
            fallback_model = "deepseek-chat"
            
        def get_fallback_model():
            if fallback_provider == "openai":
                print(f"DEBUG: Fallback redirect to OpenAI '{fallback_model}'")
                return ChatOpenAI(
                    model=fallback_model,
                    api_key=openai_key,
                    base_url=openai_base,
                    temperature=temperature,
                    max_retries=2
                )
            else:
                print(f"DEBUG: Fallback redirect to DeepSeek '{fallback_model}'")
                return ChatOpenAI(
                    model=fallback_model,
                    api_key=deepseek_key,
                    base_url="https://api.deepseek.com/v1",
                    openai_api_base="https://api.deepseek.com/v1",
                    default_headers={"Authorization": f"Bearer {deepseek_key}"} if deepseek_key else None,
                    temperature=temperature,
                    max_retries=2
                )

        # Handle UUIDs/Database IDs by defaulting to fallback
        is_known_id = any(prefix in model_id.lower() for prefix in ["gpt", "claude", "gemini", "deepseek", "grok", "llama"])
        
        print(f"DEBUG: ProviderRouter requested model_id='{model_id}', is_known_id={is_known_id}")
        
        # Claude Models or Unknown IDs - Fallback
        if "claude" in model_id.lower() or not is_known_id:
            print(f"DEBUG: Redirecting '{model_id}' (Claude/Unknown fallback)")
            return get_fallback_model()
        
        # GPT Models - Prefer low-cost OpenAI if available, else fallback
        elif "gpt" in model_id.lower():
            if openai_key:
                print(f"DEBUG: Using OpenAI model '{model_id}'")
                return ChatOpenAI(
                    model=model_id,
                    api_key=openai_key,
                    base_url=openai_base,
                    temperature=temperature,
                    max_retries=2
                )
            return get_fallback_model()
        
        # Gemini Models
        elif "gemini" in model_id:
            gemini_key = os.getenv("GOOGLE_AI_API_KEY", "").strip() or None
            if gemini_key:
                actual_model = "gemini-flash-latest" if "flash" in model_id else "gemini-pro-latest"
                print(f"DEBUG: Using Google Gemini model: {actual_model}")
                return ChatGoogleGenerativeAI(
                    model=actual_model,
                    google_api_key=gemini_key,
                    temperature=temperature,
                    convert_system_message_to_human=True
                )
            return get_fallback_model()
        
        # DeepSeek Models (OpenAI Compatible)
        elif "deepseek" in model_id:
            if deepseek_key:
                print(f"DEBUG: Using DeepSeek model directly")
                return ChatOpenAI(
                    model="deepseek-chat",
                    api_key=deepseek_key,
                    base_url="https://api.deepseek.com/v1",
                    openai_api_base="https://api.deepseek.com/v1",
                    temperature=temperature,
                    max_retries=2
                )
            return get_fallback_model()
            
        # xAI Models - Redirected to fallback
        elif "grok" in model_id or "xai" in model_id:
            return get_fallback_model()
            
        # Default fallback
        else:
            return get_fallback_model()
