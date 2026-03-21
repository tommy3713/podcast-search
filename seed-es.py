"""
Seed Elasticsearch from raw JSON files in notes/gooaye/.
Each file already contains: title, uploadDate, episode, fullTitle, podcaster, content, note.
Also creates the podcast_chunks index and embeds chunks for vector search.

Usage:
    pip install "elasticsearch>=8,<9" openai python-dotenv
    ELASTIC_URL=http://localhost:9200 \
    ELASTIC_USERNAME=elastic \
    ELASTIC_PASSWORD=<password> \
    OPENAI_API_KEY=<key> \
    python seed-es.py
"""

import os
import json
import time
from elasticsearch import Elasticsearch
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

ES_HOST = os.getenv("ELASTIC_URL", "http://localhost:9200")
ES_USERNAME = os.getenv("ELASTIC_USERNAME", "elastic")
ES_PASSWORD = os.getenv("ELASTIC_PASSWORD")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
INDEX_NAME = "podcast"
CHUNKS_INDEX_NAME = "podcast_chunks"
NOTES_DIR = "./notes/gooaye"
CHUNK_SIZE = 800
CHUNK_OVERLAP = 160

es = Elasticsearch([ES_HOST], http_auth=(ES_USERNAME, ES_PASSWORD))
openai_client = OpenAI(api_key=OPENAI_API_KEY)


def chunk_text(text, chunk_size=CHUNK_SIZE, overlap=CHUNK_OVERLAP):
    chunks = []
    start = 0
    while start < len(text):
        chunks.append(text[start:start + chunk_size])
        start += chunk_size - overlap
    return chunks


def sanitize(text):
    # Remove null bytes and ASCII control characters that break JSON
    return ''.join(c for c in text if c >= ' ' or c in '\n\r\t')


def embed_text(text):
    response = openai_client.embeddings.create(
        model="text-embedding-3-small",
        input=sanitize(text),
    )
    return response.data[0].embedding


# --- Create podcast index ---
if not es.indices.exists(index=INDEX_NAME):
    es.indices.create(index=INDEX_NAME, body={
        "settings": {
            "analysis": {
                "analyzer": {"chinese": {"type": "icu_analyzer"}}
            }
        },
        "mappings": {
            "properties": {
                "podcaster":  {"type": "keyword"},
                "title":      {"type": "text", "analyzer": "icu_analyzer"},
                "uploadDate": {"type": "keyword"},
                "episode":    {"type": "keyword"},
                "fullTitle":  {"type": "keyword"},
                "content":    {"type": "text", "analyzer": "icu_analyzer"},
                "note":       {"type": "text", "analyzer": "icu_analyzer"},
            }
        }
    })
    print(f"Created index: {INDEX_NAME}")
else:
    print(f"Index already exists: {INDEX_NAME}")

# --- Create podcast_chunks index ---
if not es.indices.exists(index=CHUNKS_INDEX_NAME):
    es.indices.create(index=CHUNKS_INDEX_NAME, body={
        "mappings": {
            "properties": {
                "podcaster":   {"type": "keyword"},
                "episode":     {"type": "keyword"},
                "uploadDate":  {"type": "keyword"},
                "fullTitle":   {"type": "keyword"},
                "chunk_index": {"type": "integer"},
                "content":     {"type": "text"},
                "embedding":   {
                    "type": "dense_vector",
                    "dims": 1536,
                    "index": True,
                    "similarity": "cosine",
                },
            }
        }
    })
    print(f"Created index: {CHUNKS_INDEX_NAME}")
else:
    print(f"Index already exists: {CHUNKS_INDEX_NAME}")

# --- Seed documents ---
files = [f for f in os.listdir(NOTES_DIR) if f.endswith(".json")]
print(f"\nFound {len(files)} JSON files in {NOTES_DIR}")

success, failed = 0, 0

for file_name in files:
    path = os.path.join(NOTES_DIR, file_name)
    try:
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)

        full_title = doc.get("fullTitle")
        if not full_title:
            print(f"  [SKIP] No fullTitle in {file_name}")
            continue

        # Upsert into podcast index (exclude embeddings — those go in podcast_chunks only)
        podcast_doc = {k: v for k, v in doc.items() if k != "embeddings"}
        result = es.search(
            index=INDEX_NAME,
            body={"query": {"term": {"fullTitle": full_title}}, "size": 1},
        )
        hits = result["hits"]["hits"]
        if hits:
            es.update(index=INDEX_NAME, id=hits[0]["_id"], body={"doc": podcast_doc})
            print(f"  [UPDATE] {full_title}")
        else:
            es.index(index=INDEX_NAME, document=podcast_doc)
            print(f"  [CREATE] {full_title}")

        # Chunk and embed into podcast_chunks
        # Use cached embeddings from the JSON file if available to avoid repeated API calls
        content = doc.get("content", "")
        chunks = chunk_text(content)
        cached_embeddings = doc.get("embeddings")  # list of vectors, one per chunk

        if cached_embeddings and len(cached_embeddings) == len(chunks):
            print(f"  [CACHE HIT] {full_title} → {len(chunks)} chunks (no API call)")
            embeddings = cached_embeddings
        else:
            print(f"  [EMBED] {full_title} → {len(chunks)} chunks")
            embeddings = []
            for chunk in chunks:
                embeddings.append(embed_text(chunk))
                time.sleep(0.05)  # gentle rate limiting
            # Save embeddings back to the JSON file for future runs
            doc["embeddings"] = embeddings
            with open(path, "w", encoding="utf-8") as f:
                json.dump(doc, f, ensure_ascii=False, indent=4)
            print(f"  [CACHED] Saved embeddings to {file_name}")

        for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            es.index(index=CHUNKS_INDEX_NAME, document={
                "podcaster":   doc.get("podcaster"),
                "episode":     doc.get("episode"),
                "uploadDate":  doc.get("uploadDate"),
                "fullTitle":   full_title,
                "chunk_index": i,
                "content":     chunk,
                "embedding":   embedding,
            })

        success += 1
    except Exception as e:
        print(f"  [ERROR]  {file_name}: {e}")
        failed += 1

print(f"\nDone. success={success}  failed={failed}")
