import requests, json

plan = {
    "project_name": "NeuralFlow AI SaaS Landing Page",
    "markdown_plan": "Hero with gradient headline, 6 feature glass cards with lucide icons, 3 pricing tiers, footer. Tailwind dark theme purple accents.",
    "tech_stack": ["React", "Tailwind CSS"],
    "status": "proposed"
}

r = requests.post("http://localhost:8001/brain/chat/stream", json={
    "user_id": "test",
    "conversation_id": "09ba9cca-aead-403f-92fb-0fcfc7b1bffb",
    "content": "Plan looks great, proceed with build",
    "plan_approved": True,
    "approved_plan": json.dumps(plan),
    "framework": "react"
}, stream=True, timeout=300)

for line in r.iter_lines():
    if line:
        decoded = line.decode()
        if decoded.startswith("data:"):
            data = decoded[5:].strip()
            if data and data != "{}":
                try:
                    evt = json.loads(data)
                    key = list(evt.keys())[0] if evt else "empty"
                    print(f"Event: {key}")
                    if "create_tasks" in evt:
                        tasks = evt["create_tasks"].get("plan", [])
                        print(f"  Tasks: {len(tasks)}")
                        for t in tasks:
                            cat = t.get("category", "?")
                            title = t.get("title", "")
                            print(f"    [{cat}] {title}")
                    if "task_started" in evt:
                        ts = evt["task_started"]
                        print(f"  Task started: {ts.get('task_label', '')} ({ts.get('current_task_index', 0)+1}/{ts.get('total_tasks', 0)})")
                    if "execute_sandbox" in evt:
                        exe = evt["execute_sandbox"]
                        if exe.get("activities"):
                            for a in exe["activities"]:
                                print(f"  Activity: {a.get('label', '')}")
                        if exe.get("progress_msg"):
                            msg = exe["progress_msg"][:120]
                            print(f"  Progress: {msg}")
                    if "final_report" in evt:
                        print("  FINAL REPORT received!")
                except Exception as e:
                    pass
            elif data == "{}":
                print("Event: end")
