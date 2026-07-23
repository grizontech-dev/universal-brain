import os
from typing import Dict, Any, List
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from Brain.services.provider_router import ProviderRouter

class LeaderAgent:
    @staticmethod
    async def analyze(prompt: str, model_id: str = "deepseek-chat", history: List[Dict[str, Any]] = None, temperature: float = 0.4) -> Dict[str, Any]:
        """The PM Leader Agent analyzes the request and provides an initial technical perspective."""
        model = ProviderRouter.get_model(model_id, temperature=temperature)
        
        system_prompt = """You are the Grizon Project Leader (PM Agent). 
Your goal is to lead the development process by analyzing user requests and setting the technical direction.

When a user provides a prompt, you should:
1. Acknowledge the request with a professional, leadership-oriented tone.
2. Provide a high-level technical assessment of what needs to be done.
3. Identify if any critical information is missing.
4. Set the stage for the 'Research' and 'Planning' phases.

IMPORTANT: If this is a follow-up response from the user answering previous questions, acknowledge the new information and explain how it helps refine the direction.

Keep your response concise but authoritative. Use technical terminology appropriately."""

        messages = [SystemMessage(content=system_prompt)]
        
        # Add history if available
        if history:
            for msg in history[:-1]: # Include all except the very last one which was just added to DB but is also the 'prompt'
                role = msg.get("role", "USER")
                content = msg.get("content", "")
                if role == "USER":
                    messages.append(HumanMessage(content=content))
                else:
                    messages.append(SystemMessage(content=f"Assistant: {content}"))
        
        messages.append(HumanMessage(content=prompt))

        response = await model.ainvoke(messages)
        
        # We also want to extract a confidence score or similar metadata
        # If it's a follow-up, we are generally more confident because we are refining
        is_follow_up = history and len(history) > 0
        base_confidence = 0.9 if len(prompt.split()) > 5 or is_follow_up else 0.4
        
        return {
            "leader_analysis": response.content,
            "confidence": min(1.0, base_confidence + (0.1 if is_follow_up else 0)),
            "status": "led",
            "suggested_title": await LeaderAgent.generate_title(prompt, model_id) if not is_follow_up else None
        }

    @staticmethod
    async def generate_title(prompt: str, model_id: str = "deepseek-chat") -> str:
        """Generates a concise title for the project."""
        model = ProviderRouter.get_model(model_id, temperature=0.3)
        system_prompt = "Generate a concise title (max 50 chars) for this project request. Return ONLY the title text."
        response = await model.ainvoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=prompt)
        ])
        return response.content.strip().strip('"').strip("'")
