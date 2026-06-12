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
        self.embeddings = OpenAIEmbeddings(api_key=os.getenv("OPENAI_API_KEY"))
        self.vectorstore = None
        self._init_vectorstore()
        self.compiler_llm = ChatOpenAI(
            api_key=os.getenv("OPENAI_API_KEY"),
            model="gpt-4o-mini",
            temperature=0
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

    def resolve_skills_for_task(self, task_description: str) -> str:
        """End-to-end pipeline to get compiled JSON rules for a task."""
        print(f"\n[SkillResolver] 🔍 Analyzing task: {task_description[:100]}...")
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
        
        return json_rules

# Test the resolver when run directly
if __name__ == "__main__":
    resolver = SkillResolver()
    task = "Create a modern SaaS landing page using shadcn and Next.js"
    print(f"Task: {task}")
    print("Compiling skills...")
    rules = resolver.resolve_skills_for_task(task)
    print("\nCompiled Rules:")
    print(rules)
