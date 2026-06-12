import os
import time
import json
import asyncio
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from typing import Callable, Dict, Any, List

class WorkspaceEventHandler(FileSystemEventHandler):
    def __init__(self, sandbox_id: str, base_path: str, callback: Callable[[Dict[str, Any]], None]):
        self.sandbox_id = sandbox_id
        self.base_path = base_path
        self.callback = callback
        self.loop = asyncio.get_event_loop()

    def _get_relative_path(self, absolute_path: str) -> str:
        return os.path.relpath(absolute_path, self.base_path).replace("\\", "/")

    def _emit(self, event_type: str, path: str, old_path: str = None):
        rel_path = self._get_relative_path(path)
        # Avoid noise from common dev files
        if any(x in rel_path for x in [".git", "node_modules", ".next", "dist", "build"]):
            return

        ops = []
        if event_type in ["created", "modified", "moved"]:
            if old_path:
                old_rel = self._get_relative_path(old_path)
                ops.append({"op": "delete_file", "path": old_rel})
            
            try:
                with open(path, "r", encoding="utf-8") as f:
                    content = f.read()
                ops.append({
                    "op": "write_file",
                    "path": rel_path,
                    "content": content
                })
            except Exception:
                pass # Binary files or unreadable files are ignored
        elif event_type == "deleted":
            ops.append({"op": "delete_file", "path": rel_path})

        if not ops:
            return

        data = {
            "type": "workspace_ops",
            "sandbox_id": self.sandbox_id,
            "ops": ops,
            "timestamp": time.time()
        }
        
        # We need to run the callback in the event loop if it's async
        if asyncio.iscoroutinefunction(self.callback):
            self.loop.call_soon_threadsafe(lambda: asyncio.create_task(self.callback(data)))
        else:
            self.callback(data)

    def on_modified(self, event):
        if not event.is_directory:
            self._emit("modified", event.src_path)

    def on_created(self, event):
        if not event.is_directory:
            self._emit("created", event.src_path)

    def on_deleted(self, event):
        if not event.is_directory:
            self._emit("deleted", event.src_path)

    def on_moved(self, event):
        if not event.is_directory:
            self._emit("moved", event.dest_path, old_path=event.src_path)

class WorkspaceWatcher:
    def __init__(self, sandbox_id: str, workspace_path: str, callback: Callable[[Dict[str, Any]], None]):
        self.sandbox_id = sandbox_id
        self.workspace_path = workspace_path
        self.event_handler = WorkspaceEventHandler(sandbox_id, workspace_path, callback)
        self.observer = Observer()
        self.observer.schedule(self.event_handler, self.workspace_path, recursive=True)

    def start(self):
        print(f"Starting workspace watcher for {self.sandbox_id} at {self.workspace_path}")
        self.observer.start()

    def stop(self):
        print(f"Stopping workspace watcher for {self.sandbox_id}")
        self.observer.stop()
        self.observer.join()

class WatcherManager:
    def __init__(self):
        self.watchers: Dict[str, WorkspaceWatcher] = {}

    def start_watching(self, sandbox_id: str, path: str, callback: Callable[[Dict[str, Any]], None]):
        if sandbox_id in self.watchers:
            self.stop_watching(sandbox_id)
        
        watcher = WorkspaceWatcher(sandbox_id, path, callback)
        watcher.start()
        self.watchers[sandbox_id] = watcher

    def stop_watching(self, sandbox_id: str):
        if sandbox_id in self.watchers:
            self.watchers[sandbox_id].stop()
            del self.watchers[sandbox_id]

watcher_manager = WatcherManager()
