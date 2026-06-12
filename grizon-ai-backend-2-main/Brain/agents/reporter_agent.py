from typing import List, Dict, Any
from langchain_core.messages import SystemMessage, HumanMessage
from Brain.services.provider_router import ProviderRouter

class ReporterAgent:
    """Agent specialized in synthesizing sandbox results into a final technical report."""
    
    @staticmethod
    async def synthesize(user_request: str, executed_tasks: List[Dict[str, Any]], model_id: str, temperature: float = 0.3) -> str:
        model = ProviderRouter.get_model(model_id, temperature=temperature)
        
        # Format the task results for the LLM
        tasks_context = ""
        for i, task in enumerate(executed_tasks):
            tasks_context += f"Task {i+1}: {task.get('task')}\n"
            tasks_context += f"Status: {task.get('status')}\n"
            if task.get("result"):
                tasks_context += f"Findings: {task.get('result')}\n"
            tasks_context += "---\n"

        system_prompt = """
        You are the Grizon Technical Reporter. Your goal is to provide a final, high-fidelity technical report based on the results of autonomous research.
        
        **RULES**:
        1. **Fulfill the Request**: Answer the user's specific question (e.g., 'how are weights loaded?') using the provided task findings.
        2. **Technical Depth**: Use code-level details, file paths, and architectural concepts found during the analysis.
        3. **Structure**: Use professional Markdown with headers, code blocks, and bullet points.
        4. **Tone**: authoritative, precise, and professional.
        5. **No Fluff**: Do not mention the "process" or "agents". Just give the technical answer.
        """
        
        user_input = f"""
        User Request: {user_request}
        
        Autonomous Research Findings:
        {tasks_context}
        """
        
        response = await model.ainvoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_input)
        ])
        
        return response.content
