"""
Seed Elasticsearch from raw JSON files in notes/gooaye/.
Each file already contains: title, uploadDate, episode, fullTitle, podcaster, content, note.

Usage:
    pip install elasticsearch python-dotenv
    ELASTIC_URL=http://localhost:9200 \
    ELASTIC_USERNAME=elastic \
    ELASTIC_PASSWORD=<password> \
    python migrate-mongo-to-es.py
"""

import os
import json
from elasticsearch import Elasticsearch
from dotenv import load_dotenv

load_dotenv()

ES_HOST = os.getenv("ELASTIC_URL", "http://localhost:9200")
ES_USERNAME = os.getenv("ELASTIC_USERNAME", "elastic")
ES_PASSWORD = os.getenv("ELASTIC_PASSWORD")
INDEX_NAME = "podcast"
NOTES_DIR = "./notes/gooaye"

es = Elasticsearch([ES_HOST], http_auth=(ES_USERNAME, ES_PASSWORD))

# Create index if it doesn't exist
if not es.indices.exists(index=INDEX_NAME):
    es.indices.create(index=INDEX_NAME, body={
        "settings": {
            "analysis": {
                "analyzer": {
                    "chinese": {"type": "icu_analyzer"}
                }
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

files = [f for f in os.listdir(NOTES_DIR) if f.endswith(".json")]
print(f"Found {len(files)} JSON files in {NOTES_DIR}")

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

        # Check if document already exists
        result = es.search(
            index=INDEX_NAME,
            body={"query": {"term": {"fullTitle.keyword": full_title}}, "size": 1},
        )
        hits = result["hits"]["hits"]

        if hits:
            # Update existing document with note (and any other fields)
            es.update(index=INDEX_NAME, id=hits[0]["_id"], body={"doc": doc})
            print(f"  [UPDATE] {full_title}")
        else:
            # Index as new document
            es.index(index=INDEX_NAME, document=doc)
            print(f"  [CREATE] {full_title}")

        success += 1
    except Exception as e:
        print(f"  [ERROR]  {file_name}: {e}")
        failed += 1

print(f"\nDone. success={success}  failed={failed}")
