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
        
        # Safely get DeepSeek key
        deepseek_key = os.getenv("DEEPSEEK_API_KEY")
        if deepseek_key:
            deepseek_key = deepseek_key.strip()
        
        # Handle UUIDs/Database IDs by defaulting to gpt-4o
        is_known_id = any(prefix in model_id.lower() for prefix in ["gpt", "claude", "gemini", "deepseek", "grok", "llama"])
        
        print(f"DEBUG: ProviderRouter requested model_id='{model_id}', is_known_id={is_known_id}")
        
        # Claude Models or Unknown IDs - Fallback to DeepSeek
        if "claude" in model_id.lower() or not is_known_id:
            print(f"DEBUG: Redirecting '{model_id}' to DeepSeek (Claude/Unknown fallback)")
            return ChatOpenAI(
                model="deepseek-chat",
                api_key=deepseek_key,
                base_url="https://api.deepseek.com/v1",
                openai_api_base="https://api.deepseek.com/v1",
                default_headers={"Authorization": f"Bearer {deepseek_key}"} if deepseek_key else None,
                temperature=temperature,
                max_retries=2
            )
        
        # GPT Models - Prefer low-cost OpenAI if available, else fallback to DeepSeek
        elif "gpt" in model_id.lower():
            openai_key = os.getenv("OPENAI_API_KEY", "").strip()
            openai_base = os.getenv("OPENAI_BASE_URL", "").strip() or None
            if openai_key:
                print(f"DEBUG: Using OpenAI model '{model_id}'")
                return ChatOpenAI(
                    model=model_id,
                    api_key=openai_key,
                    base_url=openai_base,
                    temperature=temperature,
                    max_retries=2
                )
            print(f"DEBUG: Redirecting '{model_id}' to DeepSeek (OpenAI key missing)")
            return ChatOpenAI(
                model="deepseek-chat",
                api_key=deepseek_key,
                base_url="https://api.deepseek.com/v1",
                openai_api_base="https://api.deepseek.com/v1",
                default_headers={"Authorization": f"Bearer {deepseek_key}"} if deepseek_key else None,
                temperature=temperature,
                max_retries=2
            )
        
        # Gemini Models
        elif "gemini" in model_id:
            actual_model = "gemini-flash-latest" if "flash" in model_id else "gemini-pro-latest"
            print(f"DEBUG: Using Google Gemini model: {actual_model}")
            return ChatGoogleGenerativeAI(
                model=actual_model,
                google_api_key=os.getenv("GOOGLE_AI_API_KEY").strip(),
                temperature=temperature,
                convert_system_message_to_human=True
            )
        
        # DeepSeek Models (OpenAI Compatible)
        elif "deepseek" in model_id:
            print(f"DEBUG: Using DeepSeek model directly")
            return ChatOpenAI(
                model="deepseek-chat",
                api_key=deepseek_key,
                base_url="https://api.deepseek.com/v1",
                openai_api_base="https://api.deepseek.com/v1",
                temperature=temperature,
                max_retries=2
            )
            
        # xAI Models - Redirected to DeepSeek
        elif "grok" in model_id or "xai" in model_id:
            print(f"DEBUG: Redirecting '{model_id}' to DeepSeek (xAI fallback)")
            return ChatOpenAI(
                model="deepseek-chat",
                api_key=deepseek_key,
                base_url="https://api.deepseek.com/v1",
                openai_api_base="https://api.deepseek.com/v1",
                temperature=temperature,
                max_retries=2
            )
            
        # Default to DeepSeek if everything else fails (Universal Fallback)
        else:
            print(f"DEBUG: FINAL FALLBACK: Redirecting '{model_id}' to DeepSeek")
            return ChatOpenAI(
                model="deepseek-chat",
                api_key=deepseek_key,
                base_url="https://api.deepseek.com/v1",
                openai_api_base="https://api.deepseek.com/v1",
                temperature=temperature
            )
