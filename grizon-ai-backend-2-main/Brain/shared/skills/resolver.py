import os
import json
from dotenv import load_dotenv
from langchain_openai import OpenAIEmbeddings, ChatOpenAI
from langchain_postgres import PGVector
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.messages import SystemMessage, HumanMessage

# Load environment variables
load_dotenv(os.path.join(os.path.dirname(__file__), '../../../.env'))

DATABASE_URL = os.getenv("DATABASE_URL")
collection_name = "builderbrain_skills"

class SkillResolver:
    def __init__(self):
        self.embeddings = OpenAIEmbeddings(api_key=os.getenv("OPENAI_API_KEY"), timeout=30)
        self.vectorstore = None
        self._init_vectorstore()
        self.compiler_llm = ChatOpenAI(
            api_key=os.getenv("DEEPSEEK_API_KEY"),
            model=os.getenv("DEFAULT_CHEAP_MODEL", "deepseek-chat"),
            base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
            temperature=0,
            timeout=30
        )
    
    def _init_vectorstore(self):
        try:
            self.vectorstore = PGVector(
                embeddings=self.embeddings,
                collection_name=collection_name,
                connection=DATABASE_URL,
                use_jsonb=True,
            )
        except Exception as e:
            print(f"Warning: Failed to initialize pgvector store (skills will not be available): {e}")
            self.vectorstore = None
        
    def analyze_task(self, task_description: str) -> str:
        """Analyze the task to determine what kind of skills to search for."""
        prompt = ChatPromptTemplate.from_messages([
            ("system", "You are a task analyzer. Given a task description, identify the domain, framework, and required capabilities as a brief search query."),
            ("human", "{task}")
        ])
        chain = prompt | self.compiler_llm
        result = chain.invoke({"task": task_description})
        return result.content
        
    def semantic_search(self, query: str, limit: int = 5) -> list:
        """Search the vector store for relevant skill chunks."""
        if self.vectorstore is None:
            print("Warning: pgvector not available, skipping skill search")
            return []
        results = self.vectorstore.similarity_search(query, k=limit)
        return results
        
    def compile_skills(self, chunks: list) -> str:
        """Compile retrieved markdown chunks into concise JSON rules."""
        if not chunks:
            return "{}"
            
        context = "\n\n---\n\n".join([doc.page_content for doc in chunks])
        
        system_prompt = """
        You are a Skill Compiler for an AI Agent.
        Read the provided skill documentation chunks.
        Extract the most critical execution rules, guidelines, and constraints.
        Output them strictly as a JSON object categorizing the rules (e.g., layout, security, architecture).
        Do not include any markdown block formatting like ```json in your response, just the raw JSON object.
        """
        
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=f"SKILL CHUNKS:\n{context}")
        ]
        
        response = self.compiler_llm.invoke(messages)
        
        try:
            # Validate JSON
            parsed = json.loads(response.content)
            return json.dumps(parsed, indent=2)
        except json.JSONDecodeError:
            # Fallback if the LLM output invalid JSON
            return response.content

    def _collect_local_markdown(self, base_dir: str, allowed_names=None) -> list:
        """Walk a directory and collect markdown file contents as (name, text) pairs."""
        collected = []
        if not os.path.isdir(base_dir):
            print(f"[SkillResolver] Local skill dir not found, skipping: {base_dir}")
            return collected
        for root, dirs, files in os.walk(base_dir):
            for fname in files:
                if not fname.lower().endswith(".md"):
                    continue
                if allowed_names is not None and fname not in allowed_names:
                    continue
                path = os.path.join(root, fname)
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        text = f.read()
                except Exception as e:
                    print(f"[SkillResolver] Warning: could not read {path}: {e}")
                    continue
                skill_name = os.path.relpath(path, base_dir)
                collected.append((skill_name, text))
        return collected

    def _load_local_skills(self, task_description: str) -> str:
        """Return relevant skill FILE PATHS for on-demand reading — not content.
        
        Agents read skill files when needed via MCP read_file tool, avoiding
        45-50k token overload and hallucination from irrelevant context.
        """
        here = os.path.dirname(__file__)
        skillss_dir = os.path.join(here, "..", "..", "skillss")
        skills_dir = os.path.join(here, "..", "..", "skills")
        skillss_dir = os.path.abspath(skillss_dir)
        skills_dir = os.path.abspath(skills_dir)

        t = (task_description or "").lower()
        frontend_kw = any(k in t for k in ["frontend", "react", "ui", "component", "landing", "page", "css", "html", "design"])
        backend_kw = any(k in t for k in ["backend", "express", "api", "server", "endpoint", "fastify", "node", "microservice"])
        db_kw = any(k in t for k in ["supabase", "database", "postgres", "sql", "query", "vector"])

        def relevance(path: str) -> bool:
            # Paths are relative (e.g. "frontend-design/SKILL.md") — match on path segments,
            # NOT leading-slash substrings (those never match relative paths).
            p = path.lower().replace("\\", "/")
            parts = [seg for seg in p.split("/") if seg]
            if frontend_kw and any(d in parts for d in ["frontend", "frontend-design", "shadcn"]):
                return True
            if backend_kw and any(d in parts for d in ["backend", "backend-development", "nodejs-backend-patterns"]):
                return True
            if db_kw and any(d in parts for d in ["database", "supabase", "supabase-postgres-best-practices"]):
                return True
            return False

        skillss_files = self._collect_local_markdown(skillss_dir, allowed_names={"SKILL.md"})
        skills_files = self._collect_local_markdown(skills_dir)
        all_files = [(name, text, "skillss") for name, text in skillss_files]
        all_files += [(name, text, "skills") for name, text in skills_files]

        filtered = [x for x in all_files if relevance(x[0])]

        if not filtered:
            print(f"[SkillResolver] 🗂️ No relevant skill files found for task.")
            return ""

        # Return ONLY file paths — agent reads on demand via read_skill_file tool.
        # Paths must be relative to the Brain root so read_skill_file can resolve them.
        paths = [f"{src}/{name}".replace("\\", "/") for name, _, src in filtered]
        print(f"[SkillResolver] 🗂️ Found {len(paths)} relevant skill files (paths returned, agent reads on demand).")
        
        path_list = "\n".join(f"- {p}" for p in paths)
        return f"""SKILL FILES (read these when you need guidance — do NOT load all at once):
{path_list}

When you need help with a specific topic, use the read_skill_file tool to read the relevant skill file above. Only read what you need for the current task."""

    def resolve_skills_for_task(self, task_description: str) -> str:
        """End-to-end pipeline to get compiled JSON rules for a task.
        
        Primary path is pgvector; falls back to local markdown files when pgvector
        returns nothing or errors, so skills are always injected when available.
        """
        print(f"\n[SkillResolver] 🔍 Analyzing task: {task_description[:100]}...")
        json_rules = "{}"
        try:
            query = self.analyze_task(task_description)
            print(f"[SkillResolver] 🎯 Generated search query: {query}")
            
            chunks = self.semantic_search(query, limit=5)
            print(f"[SkillResolver] 📚 Retrieved {len(chunks)} relevant skill chunks:")
            for i, chunk in enumerate(chunks):
                skill_name = chunk.metadata.get("skill_name", "unknown")
                print(f"   -> [Chunk {i+1}] Skill Module: {skill_name}")
                
            print(f"[SkillResolver] ⚙️ Compiling chunks into structured JSON rules...")
            json_rules = self.compile_skills(chunks)
            print(f"[SkillResolver] ✅ Successfully compiled execution rules.")
        except Exception as e:
            print(f"[SkillResolver] Warning: pgvector skill path failed ({e}); will try local fallback.")
            json_rules = "{}"
        
        # Primary path produced usable guidance.
        if json_rules and json_rules.strip() not in ("", "{}"):
            return json_rules
        
        # Fallback: local markdown files on disk.
        print(f"[SkillResolver] 🔁 pgvector returned no usable skills; attempting local markdown fallback...")
        try:
            local_skills = self._load_local_skills(task_description)
        except Exception as e:
            print(f"[SkillResolver] Warning: local skill fallback failed: {e}")
            local_skills = "{}"
        
        if local_skills and local_skills.strip() not in ("", "{}"):
            return local_skills
        
        print(f"[SkillResolver] ⚠️ No skills found via pgvector or local files.")
        return "{}"

# Test the resolver when run directly
if __name__ == "__main__":
    resolver = SkillResolver()
    task = "Create a modern SaaS landing page using shadcn and Next.js"
    print(f"Task: {task}")
    print("Compiling skills...")
    rules = resolver.resolve_skills_for_task(task)
    print("\nCompiled Rules:")
    print(rules)
