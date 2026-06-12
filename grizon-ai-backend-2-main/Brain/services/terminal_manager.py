import docker
import asyncio
import os
from fastapi import WebSocket

class TerminalManager:
    def __init__(self):
        self.client = docker.APIClient(base_url='npipe:////./pipe/docker_engine') if os.name == 'nt' else docker.APIClient()
        self.sessions = {}

    async def create_session(self, sandbox_id: str, websocket: WebSocket):
        try:
            # Check if container exists
            self.client.inspect_container(sandbox_id)
            
            # Create exec instance
            exec_instance = self.client.exec_create(
                sandbox_id,
                cmd="/bin/bash",
                tty=True,
                stdin=True,
                stdout=True,
                stderr=True
            )
            
            # Start exec and get socket
            socket = self.client.exec_start(
                exec_instance['Id'],
                detach=False,
                tty=True,
                stream=True,
                socket=True
            )
            
            return socket
        except Exception as e:
            print(f"Error creating terminal session for {sandbox_id}: {e}")
            return None

terminal_manager = TerminalManager()
