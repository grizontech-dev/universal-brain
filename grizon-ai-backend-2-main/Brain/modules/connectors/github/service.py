import base64
import hashlib
import os
import secrets
import shutil
import tempfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
import openai
from cryptography.fernet import Fernet
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, FieldCondition, Filter, MatchValue, PointStruct, VectorParams
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, JSON, String

from Brain.config.database import Base, SessionLocal
from Brain.modules.connectors.supabase.service import Connector

import uuid

QDRANT_URL = os.getenv("QDRANT_URL", "http://qdrant:6333")
EMBEDDING_MODEL = os.getenv("GITHUB_CONNECTOR_EMBEDDING_MODEL", "text-embedding-3-small")
EMBEDDING_DIM = int(os.getenv("GITHUB_CONNECTOR_EMBEDDING_DIM", "1536"))
GITHUB_API_BASE = os.getenv("GITHUB_API_BASE", "https://api.github.com")
GITHUB_UPLOAD_BASE = os.getenv("GITHUB_UPLOAD_BASE", "https://uploads.github.com")


class GitHubRepository(Base):
    __tablename__ = "github_repositories"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    userId = Column(String, ForeignKey("users.id"), name="userId")
    connectorId = Column(String, ForeignKey("connectors.id"), name="connectorId")
    installationId = Column(String, name="installationId")
    repoId = Column(String, name="repoId")
    owner = Column(String)
    name = Column(String)
    fullName = Column(String, unique=True, name="fullName")
    defaultBranch = Column(String, name="defaultBranch")
    cloneUrl = Column(String, name="cloneUrl")
    htmlUrl = Column(String, name="htmlUrl")
    visibility = Column(String)
    repoMetadata = Column(JSON, name="metadata")
    isSelected = Column(Boolean, default=False, name="isSelected")
    isIndexed = Column(Boolean, default=False, name="isIndexed")
    lastSyncedAt = Column(DateTime, nullable=True, name="lastSyncedAt")
    createdAt = Column(DateTime, default=datetime.utcnow, name="createdAt")
    updatedAt = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, name="updatedAt")


class GitHubSyncJob(Base):
    __tablename__ = "github_sync_jobs"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    repositoryId = Column(String, ForeignKey("github_repositories.id"), name="repositoryId")
    status = Column(String, default="queued")
    eventType = Column(String, nullable=True, name="eventType")
    payload = Column(JSON)
    error = Column(String, nullable=True)
    startedAt = Column(DateTime, nullable=True, name="startedAt")
    finishedAt = Column(DateTime, nullable=True, name="finishedAt")
    createdAt = Column(DateTime, default=datetime.utcnow, name="createdAt")
    updatedAt = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, name="updatedAt")


@dataclass
class GitHubFileChunk:
    path: str
    chunk_index: int
    content: str
    language: Optional[str] = None


class GitHubConnectorService:
    def __init__(self):
        self.app_slug = os.getenv("GITHUB_APP_SLUG")
        self.app_id = os.getenv("GITHUB_APP_ID")
        private_key = os.getenv("GITHUB_APP_PRIVATE_KEY")
        private_key_path = os.getenv("GITHUB_APP_PRIVATE_KEY_PATH", "").strip('"')
        if not private_key and private_key_path and os.path.exists(private_key_path):
            with open(private_key_path, "r") as f:
                private_key = f.read()
        self.private_key = private_key
        self.webhook_secret = os.getenv("GITHUB_WEBHOOK_SECRET")
        self.api_base = GITHUB_API_BASE.rstrip("/")
        self.upload_base = GITHUB_UPLOAD_BASE.rstrip("/")
        self.qdrant = QdrantClient(url=QDRANT_URL)
        self.collection_name = os.getenv("GITHUB_QDRANT_COLLECTION", "github_repository_chunks")
        self._ensure_collection()

    def get_encryption_key(self):
        secret = os.getenv("JWT_SECRET", "default-secret-key-1234")
        key = hashlib.sha256(secret.encode()).digest()
        return base64.urlsafe_b64encode(key)

    @property
    def fernet(self):
        return Fernet(self.get_encryption_key())

    def encrypt_token(self, token: str) -> str:
        if not token:
            return token
        return self.fernet.encrypt(token.encode()).decode()

    def decrypt_token(self, token: str) -> str:
        if not token:
            return token
        return self.fernet.decrypt(token.encode()).decode()

    def _ensure_collection(self):
        collections = self.qdrant.get_collections().collections
        if not any(c.name == self.collection_name for c in collections):
            self.qdrant.create_collection(
                collection_name=self.collection_name,
                vectors_config=VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE),
            )

    def _embed(self, text: str) -> List[float]:
        response = openai.embeddings.create(model=EMBEDDING_MODEL, input=text)
        return response.data[0].embedding

    def _request_headers(self, access_token: str) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    def get_install_url(self, state: str) -> str:
        if not self.app_slug:
            raise ValueError("GITHUB_APP_SLUG is not configured")
        return f"https://github.com/apps/{self.app_slug}/installations/new?state={state}"

    def _app_jwt(self) -> str:
        if not self.app_id or not self.private_key:
            raise ValueError("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required")
        import jwt

        private_key = self.private_key.replace("\\n", "\n")
        now = datetime.utcnow()
        payload = {"iat": int(now.timestamp()) - 60, "exp": int(now.timestamp()) + 540, "iss": self.app_id}
        return jwt.encode(payload, private_key, algorithm="RS256")

    async def get_installation_token(self, installation_id: str) -> str:
        app_jwt = self._app_jwt()
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                f"{self.api_base}/app/installations/{installation_id}/access_tokens",
                headers={
                    "Authorization": f"Bearer {app_jwt}",
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
            )
            response.raise_for_status()
            data = response.json()
        token = data.get("token")
        if not token:
            raise ValueError("Failed to create GitHub installation token")
        return token

    def generate_pkce_challenge(self) -> Tuple[str, str]:
        code_verifier = secrets.token_urlsafe(64)
        hashed = hashlib.sha256(code_verifier.encode("ascii")).digest()
        code_challenge = base64.urlsafe_b64encode(hashed).decode("ascii").rstrip("=")
        return code_verifier, code_challenge

    async def exchange_code_for_token(self, auth_code: str, code_verifier: Optional[str] = None) -> Dict[str, Any]:
        if not self.client_id or not self.client_secret or not self.redirect_uri:
            raise ValueError("GitHub OAuth credentials are not properly configured in environment variables.")

        headers = {
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
        }
        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "code": auth_code,
            "redirect_uri": self.redirect_uri,
        }
        if code_verifier:
            data["code_verifier"] = code_verifier
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post("https://github.com/login/oauth/access_token", headers=headers, data=data)
            if response.status_code != 200:
                response.raise_for_status()
            return response.json()

    def save_github_connection(self, user_id: str, installation_id: str, metadata: Optional[Dict[str, Any]] = None):
        config = {
            "installation_id": installation_id,
            "metadata": metadata or {},
        }
        db = SessionLocal()
        try:
            connector = db.query(Connector).filter(Connector.userId == user_id, Connector.type == "github").first()
            if connector:
                connector.config = config
                connector.updatedAt = datetime.utcnow()
            else:
                connector = Connector(userId=user_id, type="github", config=config)
                db.add(connector)
            db.commit()
        finally:
            db.close()

    def get_connection(self, user_id: str) -> Optional[Connector]:
        db = SessionLocal()
        try:
            return db.query(Connector).filter(Connector.userId == user_id, Connector.type == "github").first()
        finally:
            db.close()

    def _repository_to_dict(self, repository: GitHubRepository) -> Dict[str, Any]:
        return {
            "id": repository.id,
            "userId": repository.userId,
            "connectorId": repository.connectorId,
            "installationId": repository.installationId,
            "repoId": repository.repoId,
            "owner": repository.owner,
            "name": repository.name,
            "fullName": repository.fullName,
            "defaultBranch": repository.defaultBranch,
            "cloneUrl": repository.cloneUrl,
            "htmlUrl": repository.htmlUrl,
            "visibility": repository.visibility,
            "metadata": repository.repoMetadata or {},
            "isSelected": repository.isSelected,
            "isIndexed": repository.isIndexed,
            "lastSyncedAt": repository.lastSyncedAt.isoformat() if repository.lastSyncedAt else None,
            "createdAt": repository.createdAt.isoformat() if repository.createdAt else None,
            "updatedAt": repository.updatedAt.isoformat() if repository.updatedAt else None,
        }

    def _repository_payload(self, repo: Dict[str, Any], user_id: str, connector_id: Optional[str]) -> Dict[str, Any]:
        return {
            "userId": user_id,
            "connectorId": connector_id,
            "installationId": str(repo.get("installation_id") or repo.get("installationId") or ""),
            "repoId": str(repo.get("id") or ""),
            "owner": repo.get("owner", {}).get("login") if isinstance(repo.get("owner"), dict) else repo.get("owner"),
            "name": repo.get("name"),
            "fullName": repo.get("full_name") or repo.get("fullName"),
            "defaultBranch": repo.get("default_branch") or repo.get("defaultBranch"),
            "cloneUrl": repo.get("clone_url") or repo.get("cloneUrl"),
            "htmlUrl": repo.get("html_url") or repo.get("htmlUrl"),
            "visibility": repo.get("visibility"),
            "metadata": repo,
        }

    def _repository_query(self, db, *, repository_id: Optional[str] = None, full_name: Optional[str] = None, repo_id: Optional[str] = None, user_id: Optional[str] = None):
        query = db.query(GitHubRepository)
        if repository_id:
            query = query.filter(GitHubRepository.id == repository_id)
        if full_name:
            query = query.filter(GitHubRepository.fullName == full_name)
        if repo_id:
            query = query.filter(GitHubRepository.repoId == repo_id)
        if user_id:
            query = query.filter(GitHubRepository.userId == user_id)
        return query

    def upsert_repository_record(
        self,
        user_id: str,
        installation_id: str,
        repository_payload: Dict[str, Any],
        connector_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        db = SessionLocal()
        try:
            payload = self._repository_payload({**repository_payload, "installation_id": installation_id}, user_id, connector_id)
            full_name = payload["fullName"]
            repo_id = payload["repoId"]
            repository = self._repository_query(db, full_name=full_name, repo_id=repo_id, user_id=user_id).first()
            if repository:
                for key, value in payload.items():
                    setattr(repository, key, value)
                repository.isSelected = True
                repository.updatedAt = datetime.utcnow()
            else:
                repository = GitHubRepository(**payload, isSelected=True)
                db.add(repository)
            db.commit()
            db.refresh(repository)
            return self._repository_to_dict(repository)
        finally:
            db.close()

    async def list_installation_repositories(self, installation_id: str) -> List[Dict[str, Any]]:
        access_token = await self.get_installation_token(installation_id)
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.get(
                f"{self.api_base}/installation/repositories",
                headers=self._request_headers(access_token),
            )
            response.raise_for_status()
            return response.json().get("repositories", [])

    async def read_repository_file(self, access_token: str, full_name: str, file_path: str, ref: Optional[str] = None) -> Dict[str, Any]:
        params = {"ref": ref} if ref else None
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.get(
                f"{self.api_base}/repos/{full_name}/contents/{file_path.lstrip('/')}"
                ,
                headers=self._request_headers(access_token),
                params=params,
            )
            response.raise_for_status()
            data = response.json()
            if isinstance(data, dict) and data.get("encoding") == "base64" and data.get("content"):
                data["decoded_content"] = base64.b64decode(data["content"]).decode("utf-8", errors="ignore")
            return data

    def _delete_repository_file_chunks(self, repository_id: str, file_path: str) -> None:
        self.qdrant.delete(
            collection_name=self.collection_name,
            points_selector=Filter(
                must=[
                    FieldCondition(key="repository_id", match=MatchValue(value=repository_id)),
                    FieldCondition(key="path", match=MatchValue(value=file_path)),
                ]
            ),
        )

    def _upsert_repository_file(self, repository: GitHubRepository, file_path: str, content: str, commit_sha: Optional[str] = None) -> int:
        self._delete_repository_file_chunks(repository.id, file_path)
        chunks = self._split_content(content)
        if not chunks:
            return 0

        points: List[PointStruct] = []
        file_hash = hashlib.sha256(content.encode("utf-8", errors="ignore")).hexdigest()
        language = Path(file_path).suffix.lstrip(".") or "text"
        for chunk_index, chunk_text in enumerate(chunks):
            embedding = self._embed(chunk_text)
            point_id = f"{repository.id}:{file_path}:{chunk_index}"
            points.append(
                PointStruct(
                    id=point_id,
                    vector=embedding,
                    payload={
                        "repository_id": repository.id,
                        "user_id": repository.userId,
                        "installation_id": repository.installationId,
                        "repository_full_name": repository.fullName,
                        "path": file_path,
                        "chunk_index": chunk_index,
                        "content": chunk_text,
                        "file_hash": file_hash,
                        "language": language,
                        "commit_sha": commit_sha,
                        "created_at": datetime.utcnow().isoformat(),
                    },
                )
            )

        self.qdrant.upsert(collection_name=self.collection_name, points=points)
        return len(points)

    def list_user_repositories(self, access_token: str) -> List[Dict[str, Any]]:
        url = f"{self.api_base}/user/repos"
        response = httpx.get(url, headers=self._request_headers(access_token), timeout=60)
        response.raise_for_status()
        return response.json()

    def save_repository_selection(self, user_id: str, repositories: List[Dict[str, Any]], installation_id: str, connector_id: Optional[str] = None) -> List[Dict[str, Any]]:
        db = SessionLocal()
        stored: List[Dict[str, Any]] = []
        try:
            selected_full_names = {repo.get("full_name") or repo.get("fullName") for repo in repositories}
            existing = db.query(GitHubRepository).filter(GitHubRepository.userId == user_id).all()
            existing_map = {repo.fullName: repo for repo in existing if repo.fullName}

            for repo in repositories:
                payload = self._repository_payload({**repo, "installation_id": installation_id}, user_id, connector_id)
                full_name = payload["fullName"]
                if not full_name:
                    continue
                row = existing_map.get(full_name)
                if row:
                    for key, value in payload.items():
                        setattr(row, key, value)
                    row.isSelected = True
                    row.updatedAt = datetime.utcnow()
                else:
                    row = GitHubRepository(**payload, isSelected=True)
                    db.add(row)
                stored.append(self._repository_to_dict(row))

            for repo in existing:
                if repo.fullName not in selected_full_names:
                    repo.isSelected = False
                    repo.updatedAt = datetime.utcnow()

            db.commit()
            return stored
        finally:
            db.close()

    def update_repository_index_state(self, repository_id: str, is_indexed: bool, last_synced_at: Optional[datetime] = None):
        db = SessionLocal()
        try:
            repository = db.query(GitHubRepository).filter(GitHubRepository.id == repository_id).first()
            if not repository:
                raise ValueError("Repository not found")
            repository.isIndexed = is_indexed
            repository.lastSyncedAt = last_synced_at or datetime.utcnow()
            repository.updatedAt = datetime.utcnow()
            db.commit()
        finally:
            db.close()

    def get_repository(self, repository_id: str) -> Optional[GitHubRepository]:
        db = SessionLocal()
        try:
            return db.query(GitHubRepository).filter(GitHubRepository.id == repository_id).first()
        finally:
            db.close()

    def list_repositories_for_user(self, user_id: str) -> List[GitHubRepository]:
        db = SessionLocal()
        try:
            return db.query(GitHubRepository).filter(GitHubRepository.userId == user_id).order_by(GitHubRepository.createdAt.desc()).all()
        finally:
            db.close()

    def save_sync_job(self, repository_id: str, payload: Dict[str, Any], event_type: Optional[str] = None) -> GitHubSyncJob:
        db = SessionLocal()
        try:
            job = GitHubSyncJob(repositoryId=repository_id, payload=payload, eventType=event_type, status="queued")
            db.add(job)
            db.commit()
            db.refresh(job)
            return job
        finally:
            db.close()

    def update_sync_job(self, job_id: str, status: str, error: Optional[str] = None):
        db = SessionLocal()
        try:
            job = db.query(GitHubSyncJob).filter(GitHubSyncJob.id == job_id).first()
            if not job:
                raise ValueError("Sync job not found")
            job.status = status
            job.error = error
            now = datetime.utcnow()
            job.updatedAt = now
            if status == "running" and not job.startedAt:
                job.startedAt = now
            if status in {"completed", "failed"}:
                job.finishedAt = now
            db.commit()
        finally:
            db.close()

    def _split_content(self, content: str, max_chars: int = 2000) -> List[str]:
        if not content:
            return []
        chunks = []
        start = 0
        while start < len(content):
            end = min(start + max_chars, len(content))
            chunks.append(content[start:end])
            start = end
        return chunks

    def _is_supported_file(self, path: str) -> bool:
        ignored_dirs = {".git", "node_modules", "dist", "build", "coverage", "vendor", ".next"}
        parts = Path(path).parts
        return not any(part in ignored_dirs for part in parts)

    def clone_repository(self, clone_url: str, access_token: Optional[str] = None) -> str:
        temp_dir = tempfile.mkdtemp(prefix="github-repo-")
        auth_url = clone_url
        if access_token and clone_url.startswith("https://"):
            auth_url = clone_url.replace("https://", f"https://x-access-token:{access_token}@", 1)
        import subprocess

        subprocess.run(["git", "clone", "--depth", "1", auth_url, temp_dir], check=True, capture_output=True, text=True)
        return temp_dir

    def read_repository_files(self, repository_path: str) -> List[GitHubFileChunk]:
        root = Path(repository_path)
        chunks: List[GitHubFileChunk] = []
        for file_path in root.rglob("*"):
            if not file_path.is_file() or not self._is_supported_file(str(file_path)):
                continue
            try:
                content = file_path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            relative_path = str(file_path.relative_to(root)).replace("\\", "/")
            language = file_path.suffix.lstrip(".") or None
            for index, chunk in enumerate(self._split_content(content)):
                chunks.append(GitHubFileChunk(path=relative_path, chunk_index=index, content=chunk, language=language))
        return chunks

    def index_repository(self, repository_id: str, repository_path: str, project_id: Optional[str] = None) -> Dict[str, Any]:
        repository = self.get_repository(repository_id)
        if not repository:
            raise ValueError("Repository not found")

        chunks = self.read_repository_files(repository_path)
        points = []
        for chunk in chunks:
            embedding = self._embed(chunk.content)
            point_id = str(uuid.uuid4())
            points.append(
                PointStruct(
                    id=point_id,
                    vector=embedding,
                    payload={
                        "repository_id": repository_id,
                        "project_id": project_id,
                        "path": chunk.path,
                        "chunk_index": chunk.chunk_index,
                        "language": chunk.language,
                        "content": chunk.content,
                        "full_name": repository.fullName,
                        "created_at": datetime.utcnow().isoformat(),
                    },
                )
            )

        if points:
            self.qdrant.upsert(collection_name=self.collection_name, points=points)
            self.update_repository_index_state(repository_id, True, datetime.utcnow())

        return {"repository_id": repository_id, "chunks_indexed": len(points), "project_id": project_id}

    def search_repository(self, repository_id: str, query: str, limit: int = 5) -> List[Dict[str, Any]]:
        query_vector = self._embed(query)
        results = self.qdrant.search(
            collection_name=self.collection_name,
            query_vector=query_vector,
            limit=limit,
            query_filter=Filter(must=[FieldCondition(key="repository_id", match=MatchValue(value=repository_id))]),
        )
        return [
            {
                "id": str(result.id),
                "score": result.score,
                "path": result.payload.get("path"),
                "chunk_index": result.payload.get("chunk_index"),
                "language": result.payload.get("language"),
                "content": result.payload.get("content"),
                "full_name": result.payload.get("full_name"),
            }
            for result in results
        ]

    def get_repository_file(self, access_token: str, full_name: str, path: str, ref: Optional[str] = None) -> Dict[str, Any]:
        params = {"ref": ref} if ref else None
        url = f"{self.api_base}/repos/{full_name}/contents/{path.lstrip('/')}"
        response = httpx.get(url, headers=self._request_headers(access_token), params=params, timeout=60)
        response.raise_for_status()
        data = response.json()
        if isinstance(data, dict) and data.get("encoding") == "base64" and data.get("content"):
            decoded = base64.b64decode(data["content"]).decode("utf-8", errors="ignore")
            data["decoded_content"] = decoded
        return data

    async def create_branch(self, access_token: str, full_name: str, new_branch: str, from_branch: str) -> Dict[str, Any]:
        ref_response = await self._request_json("GET", f"{self.api_base}/repos/{full_name}/git/ref/heads/{from_branch}", token=access_token)
        sha = ref_response["object"]["sha"]
        return await self._request_json(
            "POST",
            f"{self.api_base}/repos/{full_name}/git/refs",
            token=access_token,
            json={"ref": f"refs/heads/{new_branch}", "sha": sha},
        )

    async def create_pull_request(self, access_token: str, full_name: str, title: str, body: str, head: str, base: str) -> Dict[str, Any]:
        return await self._request_json(
            "POST",
            f"{self.api_base}/repos/{full_name}/pulls",
            token=access_token,
            json={"title": title, "body": body, "head": head, "base": base},
        )

    async def create_or_update_file(self, access_token: str, full_name: str, path: str, content: str, message: str, branch: str) -> Dict[str, Any]:
        encoded = base64.b64encode(content.encode("utf-8")).decode("ascii")
        current = await self._request_json(
            "GET",
            f"{self.api_base}/repos/{full_name}/contents/{path.lstrip('/')}",
            token=access_token,
            params={"ref": branch},
        )
        sha = None
        if isinstance(current, dict):
            sha = current.get("sha")
        payload = {"message": message, "content": encoded, "branch": branch}
        if sha:
            payload["sha"] = sha
        return await self._request_json(
            "PUT",
            f"{self.api_base}/repos/{full_name}/contents/{path.lstrip('/')}",
            token=access_token,
            json=payload,
        )

    def delete_local_clone(self, repository_path: str):
        shutil.rmtree(repository_path, ignore_errors=True)

    def verify_webhook_signature(self, payload: bytes, signature: str) -> bool:
        if not self.webhook_secret:
            return False
        import hmac

        expected = hmac.new(self.webhook_secret.encode(), payload, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature.replace("sha256=", ""))

    def _extract_push_file_changes(self, payload: Dict[str, Any]) -> Dict[str, List[str]]:
        added: List[str] = []
        modified: List[str] = []
        removed: List[str] = []
        for commit in payload.get("commits", []) or []:
            added.extend(commit.get("added", []) or [])
            modified.extend(commit.get("modified", []) or [])
            removed.extend(commit.get("removed", []) or [])
        head_commit = payload.get("head_commit") or {}
        added.extend(head_commit.get("added", []) or [])
        modified.extend(head_commit.get("modified", []) or [])
        removed.extend(head_commit.get("removed", []) or [])
        return {
            "added": sorted(set(added)),
            "modified": sorted(set(modified)),
            "removed": sorted(set(removed)),
        }

    def _get_repository_by_repo_id(self, repo_id: str) -> Optional[GitHubRepository]:
        db = SessionLocal()
        try:
            repository = self._repository_query(db, repo_id=repo_id).first()
            if repository:
                db.expunge(repository)
            return repository
        finally:
            db.close()

    async def handle_webhook(self, event_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        if event_type == "installation_repositories":
            installation = payload.get("installation") or {}
            installation_id = str(installation.get("id") or "")
            repositories_added = payload.get("repositories_added") or []
            repositories_removed = payload.get("repositories_removed") or []
            synced: List[Dict[str, Any]] = []
            db = SessionLocal()
            try:
                for repository_payload in repositories_added:
                    repo_id = str(repository_payload.get("id") or "")
                    row = self._repository_query(db, repo_id=repo_id).first()
                    if not row:
                        continue
                    row.installationId = installation_id
                    row.repoMetadata = {**(row.repoMetadata or {}), **repository_payload}
                    row.updatedAt = datetime.utcnow()
                    synced.append(self._repository_to_dict(row))
                for repository_payload in repositories_removed:
                    repo_id = str(repository_payload.get("id") or "")
                    row = self._repository_query(db, repo_id=repo_id).first()
                    if not row:
                        continue
                    row.isSelected = False
                    row.updatedAt = datetime.utcnow()
                db.commit()
            finally:
                db.close()
            return {"event_type": event_type, "repositories_synced": synced}

        if event_type == "push":
            repository_payload = payload.get("repository") or {}
            repository_id = str(repository_payload.get("id") or "")
            repository = self._get_repository_by_repo_id(repository_id)
            if not repository:
                return {"event_type": event_type, "status": "repository_not_connected"}

            installation_token = await self.get_installation_token(repository.installationId)
            file_changes = self._extract_push_file_changes(payload)
            changed_files = [path for path in file_changes["added"] + file_changes["modified"] if path]
            removed_files = [path for path in file_changes["removed"] if path]
            commit_sha = payload.get("after") or (payload.get("head_commit") or {}).get("id")

            indexed = 0
            for file_path in changed_files:
                try:
                    file_data = await self.read_repository_file(installation_token, repository.fullName, file_path, ref=payload.get("after"))
                    decoded_content = file_data.get("decoded_content") if isinstance(file_data, dict) else None
                    if decoded_content is None and isinstance(file_data, dict):
                        decoded_content = file_data.get("content") or ""
                    if decoded_content is None:
                        continue
                    indexed += self._upsert_repository_file(repository, file_path, decoded_content, commit_sha=commit_sha)
                except Exception:
                    continue

            for file_path in removed_files:
                self._delete_repository_file_chunks(repository.id, file_path)

            db = SessionLocal()
            try:
                row = db.query(GitHubRepository).filter(GitHubRepository.id == repository.id).first()
                if row:
                    row.isIndexed = True
                    row.lastSyncedAt = datetime.utcnow()
                    row.updatedAt = datetime.utcnow()
                    row.repoMetadata = {**(row.repoMetadata or {}), "last_webhook_event": event_type, "last_commit_sha": commit_sha}
                    db.commit()
            finally:
                db.close()

            return {
                "event_type": event_type,
                "repository_id": repository.id,
                "files_synced": len(changed_files),
                "files_removed": len(removed_files),
                "chunks_indexed": indexed,
            }

        if event_type == "pull_request":
            return {
                "event_type": event_type,
                "action": payload.get("action"),
                "pull_request_number": (payload.get("pull_request") or {}).get("number"),
            }

        if event_type == "installation":
            return {"event_type": event_type, "action": payload.get("action")}

        return {"event_type": event_type, "status": "ignored"}

    def build_webhook_record(self, event_type: str, payload: Dict[str, Any], repository_id: Optional[str] = None) -> Dict[str, Any]:
        repo = payload.get("repository", {}) if isinstance(payload, dict) else {}
        return {
            "event_type": event_type,
            "repository_id": repository_id,
            "repository": repo.get("full_name") or repo.get("name"),
            "action": payload.get("action") if isinstance(payload, dict) else None,
            "delivery": payload.get("delivery") if isinstance(payload, dict) else None,
            "payload": payload,
        }
