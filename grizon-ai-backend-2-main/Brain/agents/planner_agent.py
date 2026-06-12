from typing import List, Dict, Any
from langchain_core.messages import SystemMessage, HumanMessage
from Brain.services.provider_router import ProviderRouter

class PlannerAgent:
    """Agent specialized in creating high-level strategic plans based on research and intent."""
    
    @staticmethod
    async def create_plan(content: str, search_results: str, model_id: str, repo_url: str = None, temperature: float = 0.3) -> Dict[str, Any]:
        model = ProviderRouter.get_model(model_id, temperature=temperature)
        
        system_prompt = """
        You are the Grizon AI Strategic Lead. Your goal is to create a **Strategic Execution Roadmap**. 
        
        **STRICT RULES - READ CAREFULLY**:
        1. **NO FINDINGS**: Do NOT provide any technical summaries, architectural details, or research findings in this plan. If you know the answer already, KEEP IT FOR LATER.
        2. **FOCUS ON THE PROCESS**: Your output must be a project roadmap that defines HOW the Brain will use the tools to find the answers.
        3. **ROLE**: Act as a Senior Project Architect/Manager.
        
        Structure your Roadmap as follows:
        ## 1. Project Objective
        - A concise statement of what the user wants and the success criteria.
        
        ## 2. Technical Approach
        - Briefly explain the tools (Sandbox, Web Search) and the methodology (e.g., Code Tracing, Dynamic Analysis).
        
        ## 3. Phased Execution Roadmap
        - **Phase 1: Environment & Discovery** (e.g., Clone repo, map file structure)
        - **Phase 2: Targeted Analysis** (e.g., Locate weight loading functions, trace inference calls)
        - **Phase 3: Synthesis & Reporting** (e.g., Generate the final technical summary for the user)
        
        ## 4. Required Resources
        - List the specific Repo URL and tools needed.
        
        Use clean, professional Markdown. Keep descriptions brief and action-oriented.
        """
        
        user_input = f"""
        User Intent: {content}
        Target Repository: {repo_url or "No repository provided"}
        Research Context: {search_results}
        """
        
        response = await model.ainvoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_input)
        ])
        
        # In a real implementation, we would parse the LLM response into a list
        # For now, we return a structured strategic strategy
        return {
            "strategy": response.content,
            "complexity": "medium",
            "estimated_steps": 3
        }
