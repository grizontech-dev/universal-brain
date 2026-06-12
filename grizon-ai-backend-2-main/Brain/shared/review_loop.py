import os
import json
from typing import Dict, Any
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '../../../.env'))

class QualityReviewer:
    def __init__(self):
        self.review_llm = ChatOpenAI(
            api_key=os.getenv("OPENAI_API_KEY"),
            model="gpt-4o-mini",
            temperature=0
        )

    async def review_output(self, agent_name: str, task: Dict[str, Any], skill_rules: str, generated_content: Dict[str, Any]) -> Dict[str, Any]:
        """
        Evaluates the generated code against the compiled skill rules.
        Returns a dictionary with 'passed' (bool) and 'feedback' (str).
        """
        system_prompt = f"""
        You are the Quality Assurance Reviewer for BuilderBrain.
        Your job is to review the output from the {agent_name}.
        
        You must evaluate the output against the following compiled SKILL RULES:
        {skill_rules}
        
        Additionally, enforce these checks based on the agent type:
        - Frontend: Premium spacing, intentional motion, accessible, NO generic SaaS templates.
        - Backend: Secure architecture, proper error handling, validation.
        - Database: RLS policies, secure schema, indexing.
        
        Respond ONLY in JSON format:
        {{
            "passed": true/false,
            "feedback": "Detailed feedback on what is wrong and how to fix it. Leave empty if passed."
        }}
        """
        if agent_name.lower() == "frontend agent":
            files = generated_content.get("files", [])
            file_map = {}
            for file in files:
                path = file.get("path", "")
                content = file.get("content", "")
                # Use filename without extension as the node key
                basename = os.path.basename(path)
                name, ext = os.path.splitext(basename)
                if ext in [".js", ".jsx", ".ts", ".tsx"]:
                    file_map[name] = content
            
            # Find the root node
            root_node = None
            if "App" in file_map:
                root_node = "App"
            elif "main" in file_map:
                root_node = "main"
                
            if not root_node:
                # If they created components but forgot App.jsx, fail them!
                has_components = any("components/" in f.get("path", "") or "pages/" in f.get("path", "") for f in files)
                if has_components:
                    return {
                        "passed": False,
                        "feedback": "CRITICAL FAILURE: You created frontend components but DID NOT return `frontend/src/App.jsx`. You MUST include `App.jsx` in your files list to prove the components are properly imported and rendered. App.jsx is the single source of truth. Try again and include App.jsx."
                    }

            if root_node and len(file_map) > 1:
                # Build adjacency list: node -> set of nodes it imports/mentions
                graph = {node: set() for node in file_map.keys()}
                for node, content in file_map.items():
                    for potential_dep in file_map.keys():
                        if node != potential_dep and potential_dep in content:
                            graph[node].add(potential_dep)
                
                # BFS Traversal
                visited = set()
                queue = [root_node]
                while queue:
                    curr = queue.pop(0)
                    if curr not in visited:
                        visited.add(curr)
                        for neighbor in graph[curr]:
                            if neighbor not in visited:
                                queue.append(neighbor)
                
                # Identify true orphans
                orphans = [node for node in file_map.keys() if node not in visited]
                if orphans:
                    return {
                        "passed": False,
                        "feedback": f"CRITICAL COMPONENT CONNECTIVITY FAILURE: You created files {orphans} but they are orphaned. They are not reachable from {root_node}.jsx through any parent import graph. ALL generated services, hooks, and UI components MUST be connected. Fix this."
                    }
        
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=f"TASK:\n{json.dumps(task)}\n\nGENERATED OUTPUT:\n{json.dumps(generated_content)}")
        ]
        
        response = await self.review_llm.ainvoke(messages)
        
        try:
            parsed = json.loads(response.content.strip("```json\n").strip("```").strip())
            return parsed
        except Exception as e:
            print(f"Review loop JSON parse error: {e}")
            return {"passed": True, "feedback": ""}
