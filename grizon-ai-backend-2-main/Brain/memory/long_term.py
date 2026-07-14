import os
import uuid
from datetime import datetime
import openai
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct, VectorParams, Distance, Filter, FieldCondition, MatchValue

QDRANT_URL = os.getenv("QDRANT_URL", "http://qdrant:6333")
EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIM = 1536


class LongTermMemory:
    def __init__(self):
        self.client = QdrantClient(url=QDRANT_URL)
        self.collection_name = "long_term_memory"
        self._ensure_collection()

    def _ensure_collection(self):
        collections = self.client.get_collections().collections
        if not any(c.name == self.collection_name for c in collections):
            self.client.create_collection(
                collection_name=self.collection_name,
                vectors_config=VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE)
            )

    def _embed(self, text: str) -> list:
        response = openai.embeddings.create(
            model=EMBEDDING_MODEL,
            input=text
        )
        return response.data[0].embedding

    def store(self, project_id: str, memory_type: str, content: str, metadata: dict = None):
        embedding = self._embed(content)
        point = PointStruct(
            id=str(uuid.uuid4()),
            vector=embedding,
            payload={
                "project_id": project_id,
                "memory_type": memory_type,
                "content": content,
                "metadata": metadata or {},
                "created_at": datetime.utcnow().isoformat()
            }
        )
        self.client.upsert(collection_name=self.collection_name, points=[point])

    def semantic_search(self, query: str, limit: int = 5, memory_type: str = None) -> list:
        query_vector = self._embed(query)
        filter_condition = None
        if memory_type:
            filter_condition = Filter(
                must=[FieldCondition(key="memory_type", match=MatchValue(value=memory_type))]
            )
        results = self.client.query_points(
            collection_name=self.collection_name,
            query=query_vector,
            limit=limit,
            query_filter=filter_condition
        )
        return [
            {
                "id": str(r.id),
                "project_id": r.payload.get("project_id"),
                "memory_type": r.payload.get("memory_type"),
                "content": r.payload.get("content"),
                "metadata": r.payload.get("metadata"),
                "similarity": r.score
            }
            for r in results.points
        ]

    def find_similar_projects(self, project_description: str) -> list:
        results = self.semantic_search(project_description, limit=3, memory_type="requirement")
        return [r for r in results if r["similarity"] > 0.75]
