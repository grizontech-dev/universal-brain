from fastapi import WebSocket
from typing import List, Dict, Any
import json

class ConnectionManager:
    def __init__(self):
        # sandbox_id -> list of websockets
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, sandbox_id: str):
        await websocket.accept()
        if sandbox_id not in self.active_connections:
            self.active_connections[sandbox_id] = []
        self.active_connections[sandbox_id].append(websocket)
        print(f"WebSocket connected for sandbox {sandbox_id}. Active: {len(self.active_connections[sandbox_id])}")

    def disconnect(self, websocket: WebSocket, sandbox_id: str):
        if sandbox_id in self.active_connections:
            self.active_connections[sandbox_id].remove(websocket)
            if not self.active_connections[sandbox_id]:
                del self.active_connections[sandbox_id]
        print(f"WebSocket disconnected for sandbox {sandbox_id}")

    async def broadcast_to_sandbox(self, sandbox_id: str, message: Dict[str, Any]):
        if sandbox_id in self.active_connections:
            import asyncio
            # Create a list of dead connections to remove
            dead_connections = []
            for connection in self.active_connections[sandbox_id]:
                try:
                    await asyncio.wait_for(connection.send_json(message), timeout=1.0)
                except Exception as e:
                    print(f"Error broadcasting to {sandbox_id}: {e}")
                    dead_connections.append(connection)
            
            # Clean up
            for dead in dead_connections:
                self.disconnect(dead, sandbox_id)

ws_manager = ConnectionManager()

