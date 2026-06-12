from typing import List, Dict, Any
from langchain_core.messages import SystemMessage, HumanMessage
from Brain.services.provider_router import ProviderRouter

class TaskAgent:
    """Agent specialized in breaking down a strategy into a granular Todo List of tasks."""
    
    @staticmethod
    async def create_todo_list(strategy: str, model_id: str, repo_url: str = None, temperature: float = 0.2) -> List[Dict[str, Any]]:
        import json
        import re
        model = ProviderRouter.get_model(model_id, temperature=temperature)
        
        system_prompt = f"""
        You are a Grizon AI Specialist. Your job is to translate the provided Strategic Plan into a granular Todo List.
        
        TARGET REPOSITORY: {repo_url or "No repository provided"}
        
        ADAPTIVE ROLE:
        - For software: Act as a Senior Developer. Use 'filesystem', 'terminal', 'sandbox'.
        - For business: Act as a Business Operations Lead. Use 'sandbox' for research/planning and 'terminal' for setup steps.
        - For content: Act as a Content Manager.
        
        CRITICAL RULES:
        1. **Task count**: For a full project plan, produce between 3 and 15 tasks. However, if the input is a SMALL bug fix, error trace, or quick follow-up, generate EXACTLY ONE task (e.g., "Fix Vite import error" or "Apply requested changes"). Never exceed 15 tasks total.
        2. **Specificity**: Use the exact names, milestones, and tools mentioned in the plan.
        3. **No Fluff**: Only actionable steps.
        4. **Tool Selection**: 
           - Use 'filesystem' for creating files/docs.
           - Use 'terminal' for configuration or setup.
           - Use 'sandbox' for general research, planning, or complex analysis tasks.
        5. **Output**: Respond ONLY with a valid JSON array of objects.
        
        Each task object MUST include:
        - "task": A short, descriptive title (e.g., "Clone Repository", "Trace Weight Loading").
        - "description": A 1-sentence explanation of what will be done.
        - "tool": The primary tool needed ('filesystem', 'sandbox', 'terminal').
        - "status": Always 'pending'.
        
        CRITICAL: Do NOT generate tasks about the planning process itself (e.g., "Review Plan", "Extract Tasks", "Generate JSON"). Focus ONLY on the technical execution steps described in the Strategic Plan.
        
        IMPORTANT: Your output must be a VALID JSON ARRAY. No conversational text before or after.
        """
        
        response = await model.ainvoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=f"Strategic Plan: {strategy}")
        ])
        
        try:
            # Extract JSON using regex in case of conversational padding
            content = response.content
            json_match = re.search(r'\[.*\]', content, re.DOTALL)
            if json_match:
                return json.loads(json_match.group())
            else:
                return json.loads(content)
        except Exception as e:
            print(f"Error parsing task list: {e}")
            # Fallback if parsing fails
            return [{"task": "Execute strategic plan", "description": "Running the technical analysis in the sandbox environment.", "tool": "sandbox", "status": "pending"}]
