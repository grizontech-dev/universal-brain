import os
import glob
from dotenv import load_dotenv
from langchain_openai import OpenAIEmbeddings
from langchain_community.document_loaders import TextLoader
from langchain_text_splitters import MarkdownHeaderTextSplitter, RecursiveCharacterTextSplitter
from langchain_postgres import PGVector
from sqlalchemy import create_engine
import psycopg2

# Load environment variables
load_dotenv(os.path.join(os.path.dirname(__file__), '../../../.env'))

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable not set in .env")

# Ensure the database has the pgvector extension enabled
print("Connecting to DB to ensure pgvector extension is enabled...")
try:
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
    conn.close()
    print("pgvector extension is ready.")
except Exception as e:
    print(f"Error ensuring pgvector extension: {e}")

# Connection string for PGVector
connection = DATABASE_URL
collection_name = "builderbrain_skills"

embeddings = OpenAIEmbeddings(api_key=os.getenv("OPENAI_API_KEY"))

vectorstore = PGVector(
    embeddings=embeddings,
    collection_name=collection_name,
    connection=connection,
    use_jsonb=True,
)

# Setup splitters
headers_to_split_on = [
    ("#", "Header 1"),
    ("##", "Header 2"),
    ("###", "Header 3"),
]
markdown_splitter = MarkdownHeaderTextSplitter(headers_to_split_on=headers_to_split_on)
text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=200,
)

skills_dir = os.path.join(os.path.dirname(__file__), '../../skillss')
if not os.path.isdir(skills_dir):
    print(f"Warning: skills_dir does not exist: {os.path.abspath(skills_dir)}. Nothing to ingest.")
    raise SystemExit(1)
skill_files = glob.glob(f"{skills_dir}/*/SKILL.md")

all_chunks = []

for file_path in skill_files:
    skill_name = os.path.basename(os.path.dirname(file_path))
    print(f"Processing skill: {skill_name}")
    
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Split by headers
    md_header_splits = markdown_splitter.split_text(content)
    
    # Split further by chunk size
    splits = text_splitter.split_documents(md_header_splits)
    
    for split in splits:
        split.metadata["skill_name"] = skill_name
        split.metadata["source"] = file_path
        all_chunks.append(split)

print(f"Total chunks generated: {len(all_chunks)}")

if all_chunks:
    print("Ingesting chunks into pgvector...")
    vectorstore.add_documents(all_chunks)
    print("Ingestion complete!")
else:
    print("No chunks found to ingest.")
