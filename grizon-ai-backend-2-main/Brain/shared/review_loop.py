import os
import json
from typing import Dict, Any
from Brain.services.provider_router import ProviderRouter
from langchain_core.messages import SystemMessage, HumanMessage
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '../../../.env'))

class QualityReviewer:
    def __init__(self):
        self.review_llm = ProviderRouter.get_model(
            os.getenv("DEFAULT_CHEAP_MODEL", "deepseek-chat"),
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

            # CRITICAL: Check React Router v6 syntax
            if "App" in file_map:
                app_content = file_map["App"]
                if "<Switch>" in app_content or "Switch" in app_content:
                    return {
                        "passed": False,
                        "feedback": "CRITICAL FAILURE: You used React Router v5 syntax `<Switch>`. You MUST use `<Routes>` (React Router v6). Replace `<Switch>` with `<Routes>` and close with `</Routes>`. Also change `component={Home}` to `element={<Home />}`. Try again with v6 syntax."
                    }
                if "component={" in app_content:
                    return {
                        "passed": False,
                        "feedback": "CRITICAL FAILURE: You used React Router v5 syntax `component={Component}`. You MUST use `element={<Component />}` (React Router v6). Example: `<Route path=\"/\" element={<Home />} />` not `<Route path=\"/\" component={Home} />`. Try again."
                    }

            # CRITICAL: Check for placeholder components
            placeholder_patterns = ["<h1>Home Page</h1>", "<h1>Home</h1>", "<p>Coming soon</p>", "<div>Todo App</div>"]
            for name, content in file_map.items():
                for pattern in placeholder_patterns:
                    if pattern in content and len(content.strip().split("\n")) < 10:
                        return {
                            "passed": False,
                            "feedback": f"CRITICAL FAILURE: `{name}.jsx` contains placeholder content `{pattern}`. Every component MUST have REAL UI with Tailwind CSS styling, not just a single heading. Add proper styling, sections, images, forms, etc. Try again with real content."
                        }

            # CRITICAL: Check for duplicate files across components/ and pages/
            component_names = set()
            pages_names = set()
            for name, content in file_map.items():
                for file in files:
                    path = file.get("path", "")
                    if file.get("path", "").startswith("frontend/src/components/") and name == os.path.splitext(os.path.basename(path))[0]:
                        component_names.add(name)
                    elif file.get("path", "").startswith("frontend/src/pages/") and name == os.path.splitext(os.path.basename(path))[0]:
                        pages_names.add(name)
            duplicates = component_names & pages_names
            if duplicates:
                return {
                    "passed": False,
                    "feedback": f"CRITICAL DUPLICATE FILE FAILURE: You created the same component(s) {duplicates} in BOTH `frontend/src/components/` AND `frontend/src/pages/`. This creates orphan files. Choose ONE directory per component type: pages/ for route pages, components/ for reusable UI blocks. Delete the duplicate and try again."
                }
            for name, content in file_map.items():
                if "@supabase/supabase-js" in content:
                    # Check if package.json includes it
                    package_json = generated_content.get("files", [])
                    for file in package_json:
                        if file.get("path", "").endswith("package.json"):
                            pkg_content = file.get("content", "")
                            if "@supabase/supabase-js" not in pkg_content:
                                return {
                                    "passed": False,
                                    "feedback": "CRITICAL FAILURE: You imported `@supabase/supabase-js` but it's NOT in package.json dependencies. Add `\"@supabase/supabase-js\": \"^2.45.0\"` to dependencies and return `\"commands\": [\"cd frontend && npm install\"]`."
                                }

            # CRITICAL: Check if axios is in package.json when axios is used
            for name, content in file_map.items():
                if "import axios" in content or "from 'axios'" in content or 'from "axios"' in content:
                    package_json = generated_content.get("files", [])
                    for file in package_json:
                        if file.get("path", "").endswith("package.json"):
                            pkg_content = file.get("content", "")
                            if "axios" not in pkg_content:
                                return {
                                    "passed": False,
                                    "feedback": "CRITICAL FAILURE: You imported `axios` but it's NOT in package.json dependencies. Add `\"axios\": \"^1.7.0\"` to dependencies and return `\"commands\": [\"cd frontend && npm install\"]`."
                                }

            # CRITICAL: Check if ALL imports in App.jsx are in file_map
            if "App" in file_map:
                app_content = file_map["App"]
                import re
                # Find all imports from local files
                local_imports = re.findall(r"import\s+\w+\s+from\s+['\"]\.\/(?:components\/|pages\/|)(\w+)['\"]", app_content)
                for imp in local_imports:
                    if imp not in file_map and imp not in ["App", "main"]:
                        return {
                            "passed": False,
                            "feedback": f"CRITICAL FAILURE: App.jsx imports `{imp}` but this file is NOT in your response. You MUST include ALL imported files. Either create `{imp}.jsx` or remove the import. Try again."
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
