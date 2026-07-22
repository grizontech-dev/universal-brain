import os
import uuid
import openai
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct, VectorParams, Distance, Filter, FieldCondition, MatchValue

QDRANT_URL = os.getenv("QDRANT_URL", "http://qdrant:6333")
EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIM = 1536


class QdrantImpactAnalysis:
    def __init__(self):
        self.client = QdrantClient(url=QDRANT_URL)
        self.collection_name = "artifacts"
        self._ensure_collection()

    def _ensure_collection(self):
        collections = self.client.get_collections().collections
        if not any(c.name == self.collection_name for c in collections):
            self.client.create_collection(
                collection_name=self.collection_name,
                vectors_config=VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE)
            )

    def index_artifact(self, project_id: str, artifact_id: str, name: str, file_path: str,
                       artifact_type: str, dependencies: list = None, exports: list = None,
                       language: str = None):
        text = f"{name} {file_path} {' '.join(dependencies or [])}"
        embedding = openai.embeddings.create(model=EMBEDDING_MODEL, input=text).data[0].embedding
        self.client.upsert(
            collection_name=self.collection_name,
            points=[PointStruct(
                id=str(uuid.uuid4()),
                vector=embedding,
                payload={
                    "project_id": project_id,
                    "name": name,
                    "file_path": file_path,
                    "artifact_type": artifact_type,
                    "dependencies": dependencies or [],
                    "exports": exports or [],
                    "language": language,
                }
            )]
        )

    def find_dependents(self, component_name: str, project_id: str = None) -> list:
        conditions = [FieldCondition(key="dependencies", match=MatchValue(value=component_name))]
        if project_id:
            conditions.append(FieldCondition(key="project_id", match=MatchValue(value=project_id)))
        results, _ = self.client.scroll(
            collection_name=self.collection_name,
            limit=50,
            scroll_filter=Filter(must=conditions)
        )
        return [r.payload for r in results]

    def find_dependencies(self, component_name: str, project_id: str = None) -> list:
        conditions = [FieldCondition(key="name", match=MatchValue(value=component_name))]
        if project_id:
            conditions.append(FieldCondition(key="project_id", match=MatchValue(value=project_id)))
        results, _ = self.client.scroll(
            collection_name=self.collection_name,
            limit=10,
            scroll_filter=Filter(must=conditions)
        )
        for r in results:
            return r.payload.get("dependencies", [])
        return []

    def impact_analysis(self, change_request: str, project_id: str) -> dict:
        query_embedding = openai.embeddings.create(
            model=EMBEDDING_MODEL, input=change_request
        ).data[0].embedding

        search_results = self.client.query_points(
            collection_name=self.collection_name,
            query=query_embedding,
            limit=10,
            query_filter=Filter(must=[
                FieldCondition(key="project_id", match=MatchValue(value=project_id))
            ])
        )
        return {
            "affected_artifacts": [
                {
                    "name": r.payload.get("name"),
                    "file_path": r.payload.get("file_path"),
                    "type": r.payload.get("artifact_type"),
                    "similarity": r.score
                }
                for r in search_results.points
            ]
        }
