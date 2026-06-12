import sys
import psycopg2

try:
    conn = psycopg2.connect("dbname='app' user='app' password='app' host='localhost' port='5432'")
    conn.autocommit = True
    cursor = conn.cursor()

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS brain_projects (
        id uuid PRIMARY KEY, 
        user_id uuid REFERENCES users(id), 
        conversation_id uuid REFERENCES conversations(id), 
        title text, 
        repo_url text, 
        status text, 
        created_at timestamp, 
        updated_at timestamp
    );
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS brain_tasks (
        id uuid PRIMARY KEY, 
        project_id uuid REFERENCES brain_projects(id), 
        label text, 
        strategy text, 
        agent text, 
        status text, 
        "order" integer, 
        created_at timestamp
    );
    """)

    print("Tables created successfully.")
except Exception as e:
    print("Error:", e)
    sys.exit(1)
finally:
    if 'cursor' in locals():
        cursor.close()
    if 'conn' in locals():
        conn.close()
