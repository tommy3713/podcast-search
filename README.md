# Podcast Content Search

## Project Description

This is a website that can search content for podcaster: 股癌 Gooaye

Please check this demo video: https://youtu.be/3HPLH4eA1c4

This project is still ongoing ...

I utilized OpenAI speech-to-text api to tranform podcast to word, and used Elasticsearch as my vectored DB.

For now, it only have ten episodes.

### Demo screenshot

Initial Web Page
![initial-webpage](initial-webpage.png)
Expand one seach result
![expanded-card](expanded-card.png)
Click AI summary button
![detail-episode](detail-episode.png)

## Local Developement

### Sourve python env

```bash
source openai-env/bin/activate
```

### Go to /local-dev/podcast-downloader

run

```bash
python -m podcast_downloader --config config.json
```

## Frontend

- Next.js

## Backend

- Express

## OnGoing

Planning to deploy to GCP
