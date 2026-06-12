import os
import httpx
from tavily import TavilyClient
from typing import Optional, List, Dict, Any
import anyio

class WebSearchService:
    def __init__(self):
        self.tavily_api_key = os.getenv("TAVILY_API_KEY")
        self.brave_api_key = os.getenv("BRAVE_API_KEY")
        
        if self.tavily_api_key:
            self.tavily_client = TavilyClient(api_key=self.tavily_api_key)
        else:
            self.tavily_client = None
            
    async def search(self, query: str, provider: str = "tavily", max_results: int = 5) -> Optional[Dict[str, Any]]:
        """Performs a web search using the specified provider (tavily or brave)."""
        if provider == "tavily":
            return await self._tavily_search(query, max_results)
        elif provider == "brave":
            return await self._brave_search(query, max_results)
        else:
            # Default to both if not specified or fallback? 
            # The user said "use the both", so maybe we should have a method to use both and merge results.
            return await self._tavily_search(query, max_results)

    async def search_combined(self, query: str, max_results: int = 5) -> Dict[str, Any]:
        """Performs search using both Tavily and Brave and merges results."""
        tavily_results = await self._tavily_search(query, max_results)
        brave_results = await self._brave_search(query, max_results)
        
        combined_results = []
        if tavily_results and "results" in tavily_results:
            combined_results.extend(tavily_results["results"])
        
        if brave_results and "results" in brave_results:
            combined_results.extend(brave_results["results"])
            
        return {"results": combined_results}

    async def _tavily_search(self, query: str, max_results: int = 5) -> Optional[Dict[str, Any]]:
        if not self.tavily_client:
            print("Tavily API Key not found.")
            return None
        try:
            # Tavily client is synchronous, so we run it in a thread to avoid blocking the event loop
            response = await anyio.to_thread.run_sync(
                lambda: self.tavily_client.search(query=query, search_depth="advanced", max_results=max_results)
            )
            return response
        except Exception as e:
            print(f"Tavily Search Error: {e}")
            return None

    async def _brave_search(self, query: str, max_results: int = 5) -> Optional[Dict[str, Any]]:
        if not self.brave_api_key:
            print("Brave API Key not found.")
            return None
            
        url = "https://api.search.brave.com/res/v1/web/search"
        headers = {
            "Accept": "application/json",
            "X-Subscription-Token": self.brave_api_key
        }
        params = {
            "q": query,
            "count": max_results
        }
        
        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(url, headers=headers, params=params)
                response.raise_for_status()
                data = response.json()
                
                # Format Brave results to match Tavily-like structure for consistency
                formatted_results = []
                if "web" in data and "results" in data["web"]:
                    for item in data["web"]["results"]:
                        formatted_results.append({
                            "url": item.get("url"),
                            "title": item.get("title"),
                            "content": item.get("description"), # Brave uses description
                            "score": item.get("extra_snippets", []) # Brave doesn't have a direct score like Tavily
                        })
                
                return {"results": formatted_results}
            except Exception as e:
                print(f"Brave Search Error: {e}")
                return None

    def format_results(self, results: Dict[str, Any]) -> str:
        """Formats search results for the LLM context."""
        if not results or "results" not in results or not results["results"]:
            return "No search results found."
            
        context = "Web Search Results:\n\n"
        for res in results["results"]:
            context += f"Source: {res.get('url')}\nTitle: {res.get('title')}\nContent: {res.get('content')}\n\n"
        return context
