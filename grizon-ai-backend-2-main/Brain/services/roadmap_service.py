from typing import List, Dict, Any

class RoadmapService:
    @staticmethod
    def format_todo_markdown(todo_list: List[Dict[str, Any]]) -> str:
        """Formats a raw todo list into a beautiful Markdown roadmap."""
        if not todo_list:
            return ""
            
        markdown = ""
        
        for i, item in enumerate(todo_list):
            task_name = item.get("task", "Unnamed Task")
            markdown += f"{i+1}. {task_name}\n"
            
        return markdown.strip()

roadmap_service = RoadmapService()
