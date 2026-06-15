from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

class ChatMessage(BaseModel):
    role: str
    content: str

class BrainChatRequest(BaseModel):
    user_id: str
    conversation_id: Optional[Any] = None
    content: str
    repo_url: Optional[str] = None
    model_id: Optional[str] = "claude-3-5-sonnet-20240620"
    search_provider: Optional[str] = "tavily" # "tavily", "brave", or "both"
    stream: bool = False
    plan_approved: Optional[bool] = False
    approved_plan: Optional[str] = None
    temperature: Optional[float] = 0.3
    framework: Optional[str] = "react"
    question_rounds: Optional[int] = 0
    resume_build: Optional[bool] = False
    project_id: Optional[str] = None

class BrainChatResponse(BaseModel):
    conversation_id: str
    response: str
    status: str
    todo_list: Optional[List[Dict[str, Any]]] = None
    report: Optional[str] = None
