import asyncio
import json
import os
import secrets
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from Brain.config.redis import redis_client
from Brain.modules.connectors.github.service import GitHubConnectorService
from Brain.modules.shared.auth import get_current_user
from pydantic import BaseModel


class CreateRepoRequest(BaseModel):
    name: str
    description: str = ""
    private: bool = True
    files: list[dict[str, str]] = []


router = APIRouter(prefix="/connect-github", tags=["GitHub Integration"])
github_service = GitHubConnectorService()
STATE_EXPIRATION = 600


class RepositorySelectRequest(BaseModel):
    installation_id: str
    repository: Dict[str, Any]


class SyncRequest(BaseModel):
    changed_files: Optional[List[str]] = None
    force: bool = False
    commit_sha: Optional[str] = None


class ChatRequest(BaseModel):
    question: str
    limit: int = 5


class FileChange(BaseModel):
    path: str
    content: str


class WriteChangesRequest(BaseModel):
    branch_name: str
    commit_message: str
    file_changes: List[FileChange] = Field(default_factory=list)
    base_branch: Optional[str] = None
    create_pull_request: bool = True
    pr_title: Optional[str] = None
    pr_body: Optional[str] = None


@router.get("/login")
async def login(current_user=Depends(get_current_user)):
    state = secrets.token_urlsafe(32)
    await redis_client.setex(
        f"github_oauth_state:{state}",
        STATE_EXPIRATION,
        json.dumps({"user_id": current_user.id}),
    )
    return RedirectResponse(url=github_service.get_install_url(state))


@router.get("/oauth2/callback")
async def oauth2_callback(
    installation_id: str = Query(..., description="The GitHub App installation id"),
    state: str = Query(..., description="The state parameter for CSRF validation"),
    setup_action: Optional[str] = Query(None, description="The GitHub App setup action"),
    error: Optional[str] = Query(None, description="Error from GitHub if any"),
    error_description: Optional[str] = Query(None, description="Error description from GitHub"),
):
    if error:
        raise HTTPException(status_code=400, detail=f"OAuth error: {error} - {error_description}")

    redis_key = f"github_oauth_state:{state}"
    state_payload = await redis_client.get(redis_key)
    if not state_payload:
        raise HTTPException(status_code=400, detail="Invalid or expired state parameter")
    await redis_client.delete(redis_key)

    try:
        state_data = json.loads(state_payload)
        user_id = state_data["user_id"]
    except (json.JSONDecodeError, KeyError):
        raise HTTPException(status_code=400, detail="Corrupted state parameter payload")

    try:
        github_service.save_github_connection(user_id, installation_id, {"setup_action": setup_action})
        frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
        return RedirectResponse(url=f"{frontend_url}/integrations?provider=github&status=success")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to process callback: {exc}")


@router.get("/status")
async def status(current_user=Depends(get_current_user)):
    connector = github_service.get_connection(current_user.id)
    return {"connected": connector is not None and connector.config is not None}

@router.post("/repositories/create")
async def create_repository(req: CreateRepoRequest, current_user=Depends(get_current_user)):
    try:
        connector = github_service.get_connection(current_user.id)
        if not connector or not connector.config:
            raise HTTPException(status_code=400, detail="GitHub connector is not connected")
        installation_id = connector.config.get("installation_id")
        access_token = await github_service.get_installation_token(installation_id)

        repo_data = await github_service.create_repository(
            access_token, name=req.name, description=req.description, private=req.private
        )
        full_name = repo_data["full_name"]
        default_branch = repo_data.get("default_branch", "main")

        pushed = []
        if req.files:
            pushed = await github_service.push_files_to_repo(
                access_token, full_name, req.files, branch=default_branch
            )

        return {
            "success": True,
            "repository": {
                "name": repo_data["name"],
                "full_name": full_name,
                "html_url": repo_data["html_url"],
                "clone_url": repo_data["clone_url"],
                "default_branch": default_branch,
            },
            "files_pushed": len(pushed),
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

@router.get("/repositories")
async def list_repositories(current_user=Depends(get_current_user)):
    repositories = github_service.list_repositories_for_user(current_user.id)
    return [github_service._repository_to_dict(repository) for repository in repositories]


@router.get("/repositories/{repository_id}/file")
async def read_repository_file(
    repository_id: str,
    file_path: str = Query(..., description="Repository-relative file path"),
    ref: Optional[str] = Query(None, description="Optional git ref"),
    current_user=Depends(get_current_user),
):
    try:
        repository = github_service.get_repository(repository_id)
        if not repository or repository.userId != current_user.id:
            raise HTTPException(status_code=404, detail="Repository not found")

        connector = github_service.get_connection(current_user.id)
        if not connector or not connector.config:
            raise HTTPException(status_code=400, detail="GitHub connector is not connected")

        installation_id = connector.config.get("installation_id")
        access_token = await github_service.get_installation_token(installation_id)
        return await github_service.read_repository_file(access_token, repository.fullName, file_path, ref=ref)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/repositories/discover")
async def discover_repositories(current_user=Depends(get_current_user)):
    try:
        connector = github_service.get_connection(current_user.id)
        if not connector or not connector.config:
            raise HTTPException(status_code=400, detail="GitHub connector is not connected")
        installation_id = connector.config.get("installation_id")
        return {"repositories": await github_service.list_installation_repositories(installation_id)}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/repositories/select")
async def select_repository(req: RepositorySelectRequest, current_user=Depends(get_current_user)):
    try:
        connector = github_service.get_connection(current_user.id)
        if not connector:
            raise HTTPException(status_code=400, detail="GitHub connector is not connected")
        repository = github_service.upsert_repository_record(
            current_user.id,
            req.installation_id,
            req.repository,
            connector_id=connector.id,
        )
        return {"success": True, "repository": repository}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/repositories/{repository_id}/sync")
async def sync_repository(repository_id: str, req: SyncRequest, current_user=Depends(get_current_user)):
    try:
        repository = github_service.get_repository(repository_id)
        if not repository or repository.userId != current_user.id:
            raise HTTPException(status_code=404, detail="Repository not found")

        connector = github_service.get_connection(current_user.id)
        if not connector or not connector.config:
            raise HTTPException(status_code=400, detail="GitHub connector is not connected")

        installation_id = connector.config.get("installation_id")
        access_token = await github_service.get_installation_token(installation_id)

        if req.changed_files:
            indexed = 0
            for file_path in req.changed_files:
                file_data = await github_service.read_repository_file(access_token, repository.fullName, file_path)
                decoded_content = file_data.get("decoded_content") if isinstance(file_data, dict) else None
                if decoded_content is None and isinstance(file_data, dict):
                    decoded_content = file_data.get("content") or ""
                if not decoded_content:
                    continue
                indexed += github_service._upsert_repository_file(repository, file_path, decoded_content, commit_sha=req.commit_sha)

            result = {
                "repository_id": repository.id,
                "files_indexed": len(req.changed_files),
                "chunks_indexed": indexed,
                "incremental": True,
            }
        else:
            def _run_sync() -> Dict[str, Any]:
                repo_path = github_service.clone_repository(repository.cloneUrl, access_token)
                try:
                    return github_service.index_repository(repository.id, repo_path)
                finally:
                    github_service.delete_local_clone(repo_path)

            result = await asyncio.to_thread(_run_sync)
        return {"success": True, "result": result}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/repositories/{repository_id}/chat")
async def chat_repository(repository_id: str, req: ChatRequest, current_user=Depends(get_current_user)):
    try:
        repository = github_service.get_repository(repository_id)
        if not repository or repository.userId != current_user.id:
            raise HTTPException(status_code=404, detail="Repository not found")
        return {"success": True, "result": github_service.search_repository(repository_id, req.question, req.limit)}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/repositories/{repository_id}/changes")
async def write_changes(repository_id: str, req: WriteChangesRequest, current_user=Depends(get_current_user)):
    try:
        repository = github_service.get_repository(repository_id)
        if not repository or repository.userId != current_user.id:
            raise HTTPException(status_code=404, detail="Repository not found")

        connector = github_service.get_connection(current_user.id)
        if not connector or not connector.config:
            raise HTTPException(status_code=400, detail="GitHub connector is not connected")

        installation_id = connector.config.get("installation_id")
        access_token = await github_service.get_installation_token(installation_id)
        branch_name = req.branch_name
        commit_message = req.commit_message

        async def _run_write_changes() -> Dict[str, Any]:
            repo_path = await asyncio.to_thread(github_service.clone_repository, repository.cloneUrl, access_token)
            try:
                created_branch = await github_service.create_branch(
                    access_token,
                    repository.fullName,
                    branch_name,
                    req.base_branch or repository.defaultBranch or "main",
                )
                result = []
                for change in req.file_changes:
                    result.append(
                        await github_service.create_or_update_file(
                            access_token,
                            repository.fullName,
                            change.path,
                            change.content,
                            commit_message,
                            branch_name,
                        )
                    )
                pull_request = None
                if req.create_pull_request:
                    pull_request = await github_service.create_pull_request(
                        access_token,
                        repository.fullName,
                        req.pr_title or commit_message,
                        req.pr_body or "Automated changes generated by Brain.",
                        branch_name,
                        req.base_branch or repository.defaultBranch or "main",
                    )
                return {"success": True, "branch": created_branch, "changes": result, "pull_request": pull_request}
            finally:
                github_service.delete_local_clone(repo_path)

        return await _run_write_changes()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/webhook")
async def github_webhook(
    request: Request,
    x_github_event: Optional[str] = Header(None, alias="X-GitHub-Event"),
    x_hub_signature_256: Optional[str] = Header(None, alias="X-Hub-Signature-256"),
):
    raw_payload = await request.body()
    if not github_service.verify_webhook_signature(raw_payload, x_hub_signature_256 or ""):
        raise HTTPException(status_code=401, detail="Invalid GitHub webhook signature")

    payload = json.loads(raw_payload.decode("utf-8")) if raw_payload else {}
    try:
        result = await github_service.handle_webhook(x_github_event or "unknown", payload)
        return {"success": True, "event": x_github_event, "result": result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
