# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

股癌搜尋 (https://gooaye-notes.com): an unofficial site with per-episode summaries, timestamped transcripts and cross-episode Q&A for the podcast《股癌 Gooaye》. One package: a Next.js app (`src/`) and an ingest worker (`worker/`) sharing one SQLite database.

The v1 stack (Express + Elasticsearch backend, Next 14 frontend, Python ingestion, k8s/EC2) was removed; it lives at tag `v1-es-final`. The v1 episode JSON is kept locally in gitignored `notes/gooaye/`.

## Commands

```bash
npm run dev          # web on :3005 against data/dev.db (DB_PATH overrides)
npm run dev:seed     # fill data/dev.db from scripts/fixtures (no API calls)
npm test             # vitest, all tests
npx vitest run tests/ask.test.ts
npm run typecheck
npm run build

npm run worker -- status                 # episode statuses and costs
npm run worker -- poll                   # check RSS once and process new episodes
npm run worker -- ingest 709 [--resummarize|--retranscribe] [--segments-file f]
npm run worker -- seed 10                # process the latest n episodes
npm run worker -- nightly                # purge old ask logs, back up to R2
npm run worker -- run                    # scheduler + Telegram bot (production entry point)
tsx --env-file=.env.local scripts/ask-cli.ts "問題"   # Q&A from the terminal, no quota
```

Secrets are in gitignored `.env.local` (see `.env.example`). **Never run `worker run` locally with the production `TELEGRAM_BOT_TOKEN`**: only one process may poll the bot, and production's worker already does.

`.npmrc` sets `legacy-peer-deps`; vitest is pinned to 4.x because npm 10.9 crashes on vitest 5's peers. Dependencies use exact versions.

## Architecture

### Database (`src/lib/db.ts`)

SQLite via better-sqlite3 plus the sqlite-vec extension; migrations run in `openDb(..., { migrate: true })`, which only the worker does. Tables: `episodes` (status `pending → transcribing → summarizing → done | failed`, `segments_json`, `summary_json`, `summary_draft_json`, `failed_step`, `cost_usd`), `chunks` + `chunks_fts` (FTS5 trigram) + `chunks_vec` (vec0, 1536 dims), `mentions` (category, name, code, detail, quote, start_sec), `ask_usage`, `ask_log`.

vec0 rowids must be bound as `BigInt`. Trigram FTS needs 3+ characters, so shorter search terms fall back to `LIKE` (`src/lib/ask/search.ts`).

The web reads through `readDb()` (readonly) and writes only `ask_usage` / `ask_log` through `writeDb()` (`src/lib/server-db.ts`).

### Worker (`worker/`)

`pipeline.ts` processes one episode in three checkpointed steps, each saved before the next starts, so a retry resumes from `failed_step` and never pays for a finished step twice:

1. **Transcribe** (`audio.ts`, `transcribe.ts`): download from RSS (needs a browser-like User-Agent or SoundOn returns 403), compress and split with ffmpeg, Groq `whisper-large-v3`. Gaps of 12 s+ in the result are re-transcribed on their own (Groq drops windows); a window counts as silence only when `no_speech_prob > 0.6` and `avg_logprob < -1`. `text.ts` converts with OpenCC `s2tw` (not `s2twp`) and applies known misheard-term fixes.
2. **Summarize** (`summarize.ts`): one gpt-5.5 call → `LlmSummary` (zod, `src/lib/summary.ts`): one-line summary, key points, chapters, stocks, mentions (food, sports, travel, media, games, products). `sanitizeSummary` caps lengths and drops out-of-range timestamps. Ads and non-investment brands are kept out of `stocks`.
3. **Embed and publish** (`chunk.ts`, `embed.ts`, `repo.ts`): ~600-character chunks on segment boundaries (adjacent chunks share a segment), `text-embedding-3-small`, then one transaction that swaps the episode live. Re-running a live episode keeps the old version visible until the new one publishes; a failed re-run leaves it untouched.

`schedule.ts`: RSS is polled every 30 min, 10:00–23:30 Taipei, on Wednesdays and Saturdays (release days); `nightly` runs at 03:00 (ask-log purge after 30 days, gzip backup to R2 under `backups/`, deleted by a bucket lifecycle rule after 30 days).

`bot.ts`: Telegram commands `/status`, `/poll`, `/retry N`, `/resummarize N`, `/retranscribe N`, and inline buttons (`action:N`). Only `TELEGRAM_CHAT_ID` is obeyed. All jobs run one at a time through `enqueue` in `actions.ts`. Success and failure notifications include the episode's running cost.

### Web (`src/app`)

- `/` episode list (20 per page, `?ep=` jumps to an episode), `/ep/[no]` summary + transcript (`?t=` seconds jumps the player and transcript, `?tab=tx`), `/ask`, `/about`.
- `/api/ask` (SSE): JSON content type and same-origin check → Google login (next-auth, JWT keeps only `sub` and name) → zod (≤300 chars) → quota (20 per user and 500 site-wide per Taipei day, charged up front, refunded only if nothing streamed) → OpenAI moderation → `answer()`. 30 s timeout; every request is logged to `ask_log`.
- `src/lib/ask/agent.ts`: Responses API tool loop (`ASK_MODEL`, default gpt-5.4-mini; at most 4 tool calls; `store: false` with encrypted reasoning passed back). Tools `search_transcript` (keyword + vector, RRF) and `search_mentions`. The server numbers sources; the model may only cite `[n]`, and `render.ts` drops unknown numbers and allows only `- ` lists and `**bold**`. `toInputItem` strips the SDK's `parsed_arguments` / `parsed` fields, which the API rejects as input.

### Prompt-safety rules (keep these when editing prompts)

- System prompt holds rules and server facts only; user input goes in the user role inside `<question>`, never concatenated into the system prompt. Transcripts are untrusted too (listener messages are read on air): tool results are wrapped in `<transcript>` / `<mention>` with `<>` escaped to full-width (`escapeTags`), and the prompt says tag contents are data. The most important rules go last.
- No market-sentiment tags, no bullish/bearish or 正面/負面/樂觀/保守 labels, no investment advice: only report what the host said and let listeners judge.

## Deploy

- Vultr VPS (Ubuntu 24.04, 1 vCPU / 2 GB). `/opt/gooaye` holds `compose.yml`, `Caddyfile`, `web.env`, `worker.env` (chmod 600) and `data/app.db`. Containers: `caddy` (TLS, security headers, www → apex), `web`, `worker`; only Caddy publishes ports.
- Push to `main` → `.github/workflows/gooaye-images.yml` runs typecheck and tests, then builds `ghcr.io/tommy3713/gooaye-{web,worker}` (`:latest` and `:<sha>`) from the `Dockerfile` targets. Never build on the VPS.
- After CI is green: `deploy/deploy.sh` (or `TAG=<sha> deploy/deploy.sh` to roll back). Check `/status` in Telegram first: a new worker image restarts the worker mid-episode.
- `.dockerignore` is an allowlist; add new top-level source directories to it. `next.config.ts` forces sqlite-vec's platform package into the standalone output (tracing can't see it) and excludes `data/` and `.env*`.
- Never prefix secrets with `NEXT_PUBLIC_`.

## Testing

`tests/` covers RSS parsing, text cleanup, summary validation, scheduling, repo/pipeline checkpoints, web helpers, Q&A search/render, and backup. Tests use in-memory SQLite and stub every network call (OpenAI, Groq, Telegram, R2).
