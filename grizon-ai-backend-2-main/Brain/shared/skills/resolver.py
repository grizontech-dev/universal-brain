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
            model=os.getenv("DEFAULT_CHEAP_MODEL", "deepseek-v4-pro"),
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
        """Fallback: compile skill guidance directly from local markdown files on disk."""
        here = os.path.dirname(__file__)
        skillss_dir = os.path.join(here, "..", "..", "skillss")
        skills_dir = os.path.join(here, "..", "..", "skills")
        skillss_dir = os.path.abspath(skillss_dir)
        skills_dir = os.path.abspath(skills_dir)

        # Relevance filter based on keywords in the task description.
        t = (task_description or "").lower()
        frontend_kw = any(k in t for k in ["frontend", "react", "ui", "component", "landing", "page", "css", "html", "design"])
        backend_kw = any(k in t for k in ["backend", "express", "api", "server", "endpoint", "fastify", "node", "microservice"])
        db_kw = any(k in t for k in ["supabase", "database", "postgres", "sql", "query", "vector"])

        # Map skill file -> relevance bucket.
        def relevance(name: str) -> bool:
            n = name.lower()
            if frontend_kw and any(k in n for k in ["frontend-design", "shadcn", "react", "nodejs", "skillss/frontend", "skills/frontend"]):
                return True
            if backend_kw and any(k in n for k in ["backend-development", "nodejs", "api-security", "skillss/backend", "skills/backend"]):
                return True
            if db_kw and any(k in n for k in ["supabase", "database", "skillss/database", "skills/database"]):
                return True
            return False

        # SKILL.md files come from Brain/skillss/<skill>/SKILL.md
        skillss_files = self._collect_local_markdown(skillss_dir, allowed_names={"SKILL.md"})
        # skills.md / *.md come from Brain/skills/<category>/
        skills_files = self._collect_local_markdown(skills_dir)

        filtered = [x for x in skillss_files + skills_files if relevance(x[0])]

        if filtered:
            print(f"[SkillResolver] 🗂️ Local fallback: using {len(filtered)} relevant skill files.")
        else:
            print(f"[SkillResolver] 🗂️ Local fallback: no relevance match, including ALL {len(skillss_files) + len(skills_files)} local skill files.")
            filtered = skillss_files + skills_files

        if not filtered:
            return "{}"

        parts = [f"# {name}\n\n{text}" for name, text in filtered]
        compiled = "\n\n---\n\n".join(parts)

        # Trim only if extremely long, but prefer returning the full relevant set.
        max_len = 6000
        if len(compiled) > max_len:
            print(f"[SkillResolver] ⚠️ Local fallback output truncated from {len(compiled)} to {max_len} chars.")
            compiled = compiled[:max_len] + "\n\n...\n\n(truncated local skill guidance)"
        return compiled

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
