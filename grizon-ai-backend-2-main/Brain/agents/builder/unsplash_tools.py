import os
import httpx
from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig

@tool
async def get_unsplash_image(query: str, config: RunnableConfig) -> str:
    """Fetches an image URL from Unsplash based on the given search query. Use this tool when you need a picture for a website."""
    api_key = os.getenv("UNSPLASH_API_KEY")
    if not api_key:
        return "ERROR: UNSPLASH_API_KEY environment variable is not set."
    
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                "https://api.unsplash.com/search/photos",
                params={"query": query, "per_page": 1, "client_id": api_key}
            )
            if response.status_code == 200:
                data = response.json()
                if data.get("results"):
                    image_url = data["results"][0]["urls"]["regular"]
                    return f"Successfully found image URL: {image_url}"
                else:
                    return f"No images found for query: {query}"
            else:
                return f"ERROR: Unsplash API returned status {response.status_code}: {response.text}"
    except Exception as e:
        return f"ERROR: Failed to fetch image from Unsplash: {str(e)}"
