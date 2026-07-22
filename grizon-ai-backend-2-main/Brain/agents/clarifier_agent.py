from typing import List, Dict, Any, Optional
from langchain_core.messages import SystemMessage, HumanMessage
from Brain.services.provider_router import ProviderRouter

import json
from pydantic import BaseModel, Field

class ClarificationOption(BaseModel):
    label: str = Field(description="The short text of the option (e.g. 'Hindi', 'English')")

class ClarificationQuestion(BaseModel):
    question: str = Field(description="The question to ask the user")
    options: List[ClarificationOption] = Field(description="Multiple choice options for the user to select from")

class ClarificationResponse(BaseModel):
    needs_clarification: bool = Field(description="True if the request is vague and needs clarification, False otherwise")
    preamble: str = Field(description="A friendly introductory message explaining why you need more info (e.g. 'To give you the best result, I need a few more details:')")
    questions: List[ClarificationQuestion] = Field(description="List of focused questions to ask (up to 5)")
    confidence: float = Field(description="Confidence from 0.0 to 1.0. If needs_clarification is True, confidence is low (< 0.8)")

class ClarifierAgent:
    """Agent specialized in identifying missing information and asking clarifying questions."""
    
    @staticmethod
    async def clarify(content: str, model_id: str, history: List[Dict[str, Any]] = None, temperature: float = 0.2) -> Dict[str, Any]:
        model = ProviderRouter.get_model(model_id, temperature=temperature)
        
        system_prompt = """
        You are a Grizon AI Clarifier. Your job is to analyze the user's request and determine if you have enough information to execute it.
        
        Rules:
        1. Keep the preamble friendly and professional.
        2. Each question must be clear and provide 3-5 distinct multiple-choice options.
        3. If the request is clear enough to start planning, set needs_clarification to False.
        4. ONLY set needs_clarification to True if critical information is missing that makes planning impossible.
        5. IMPORTANT: If the user has already answered previous clarifying questions, avoid asking NEW questions unless absolutely vital. Prefer proceeding to planning with the information available.
        6. If this is a follow-up, your primary goal is to validate the new info and move to research/planning.
        """
        
        # Use structured output for the LLM
        structured_model = model.with_structured_output(ClarificationResponse, method="function_calling")
        
        messages = [SystemMessage(content=system_prompt)]
        
        # Add history if available
        if history:
            for msg in history[:-1]:
                role = msg.get("role", "USER")
                content_msg = msg.get("content", "")
                if role == "USER":
                    messages.append(HumanMessage(content=content_msg))
                else:
                    messages.append(SystemMessage(content=f"Assistant: {content_msg}"))
        
        messages.append(HumanMessage(content=f"User Request: {content}"))

        try:
            response = await structured_model.ainvoke(messages)
            return response.dict()
        except Exception as e:
            print(f"Clarifier structured output failed: {e}")
            # Fallback
            is_follow_up = history and len(history) > 1
            if len(content.split()) < 5 and not is_follow_up:
                return {
                    "needs_clarification": True,
                    "preamble": "To help you better, I need to know a bit more about what you're looking for:",
                    "questions": [{
                        "question": "What type of implementation are you looking for?",
                        "options": [{"label": "Simple Script"}, {"label": "Web App"}, {"label": "Desktop App"}]
                    }],
                    "confidence": 0.3
                }
            return {"needs_clarification": False, "preamble": "", "questions": [], "confidence": 0.9}
