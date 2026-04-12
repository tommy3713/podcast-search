---
name: Notion Podcast Search Backlog
description: Notion backlog database IDs and collection URL for the podcast search app
type: reference
---

**Database page ID:** `33f262f5-fc8d-80e4-af42-d64d89a0bbe2`
**Collection (data source) URL:** `collection://33f262f5-fc8d-805b-9d8f-000b45cb6bf9`

To find In Progress tasks, search directly in the data source:
```
notion-search(
  query="In progress",
  data_source_url="collection://33f262f5-fc8d-805b-9d8f-000b45cb6bf9"
)
```
Then fetch each result to confirm Status = "In progress" (search is semantic, not filtered).

Status values: "Not started" | "In progress" | "Done"
