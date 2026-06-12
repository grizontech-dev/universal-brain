"""Deprecated: use workspace_manager."""
from Brain.services.workspace_manager import workspace_manager, RUNTIME_WEBCONTAINER

DockerSandboxManager = type(workspace_manager)
sandbox_manager = workspace_manager
