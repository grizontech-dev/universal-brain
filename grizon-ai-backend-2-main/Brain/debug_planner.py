import sys
import os
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

from Brain.agents.planner.planner_agent import PlannerAgent

def check_planner():
    agent = PlannerAgent()
    print(f"Agent Name: {agent.name}")
    print(f"Has execute: {hasattr(agent, 'execute')}")
    print(f"Methods: {[m for m in dir(agent) if not m.startswith('_')]}")

if __name__ == "__main__":
    check_planner()
