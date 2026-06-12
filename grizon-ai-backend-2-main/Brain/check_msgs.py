import asyncio
import json
from prisma import Prisma

async def main():
    p = Prisma()
    await p.connect()
    
    ms = await p.message.find_many(
        where={'conversationId': 'cmpqu0irs000b12b2nx15zs7x'},
        order={'createdAt': 'asc'}
    )
    
    results = []
    for m in ms[-10:]:
        todos = m.todoList
        if todos and isinstance(todos, str):
            try:
                todos = json.loads(todos)
            except:
                pass
        
        statuses = []
        if isinstance(todos, list):
            statuses = [t.get('status') for t in todos if isinstance(t, dict)]
            
        results.append({
            'role': m.role,
            'content': m.content[:50],
            'has_sandbox': bool(m.sandboxJob),
            'todos_count': len(todos) if isinstance(todos, list) else 0,
            'statuses': statuses
        })
        
    print(json.dumps(results, indent=2))
    await p.disconnect()

asyncio.run(main())
