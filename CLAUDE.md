# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Local dev (full stack)

```bash
docker compose up -d elasticsearch   # ES on :9200 (data persists in the podcast-search_esdata volume)
cd backend && npm start              # :3002 locally (PORT=3002 in backend/.env; code default is 3000)
cd frontend && npm run dev           # :3001
```

Locally the backend runs on 3002 because another project occupies 3000; `frontend/.env` points `NEXT_PUBLIC_BACKEND_URL` at `http://localhost:3002`. Docker compose and k8s still use 3000.

Run backend/frontend on the host (not via `docker compose up`) for dev — the compose `frontend` service bakes `NEXT_PUBLIC_BACKEND_URL` at build time and is slow to rebuild.

### Backend

```bash
cd backend
npm start          # Run dev server (port 3000)
npm test           # Run all tests (vitest)
npm run test:watch # Watch mode
npx vitest run tests/routes/search.test.js  # Run a single test file
```

### Frontend

```bash
cd frontend
npm run dev        # Run dev server (port 3001)
npm test           # Run all tests (vitest)
npm run test:watch # Watch mode
npx vitest run tests/features/searchSlice.test.ts  # Run a single test file
```

## Architecture

### Overview

Three parts, developed and deployed independently:

- **Backend** (`backend/`): Express + TypeScript, ESM (`"type": "module"`), listens on port 3000
- **Frontend** (`frontend/`): Next.js 14 App Router + TypeScript, runs on port 3001
- **Ingestion** (`auto-summarize/`): Python pipeline + TUI that turns new episodes into ES documents

`deployment/` holds k8s manifests; `aws-ec2/` holds EC2 deploy material. Root-level `*.py` scripts other than `seed-es.py` (`generate-summary.py`, `merge-data.py`, `store_notes.py`, `main.py`) are legacy.

### Data Setup

Source of truth is `notes/gooaye/*.json` (gitignored; one file per episode, ~85 episodes through EP686). Each file contains `title`, `uploadDate` (`YYYYMMDD`), `episode`, `fullTitle`, `podcaster`, `content` (raw transcript), `segments` (`[{ start, end, text }]` Whisper timestamps in seconds; only on episodes transcribed or re-transcribed since timestamps were added), `note` (GPT summary), `embeddings`, plus enrichment fields `themes`, `mentioned_stocks`, `stock_sentiments`, `investment_thesis`, `market_sentiment`, `glossary_terms`.

To build ES from scratch (empty volume):

1. Start ES and wait ~60s — the container installs the `analysis-icu` plugin on first start (Traditional Chinese tokenization).
2. Create the indices with correct mappings. `seed-es.py` creates `podcast` (`icu_analyzer` on text fields) and `podcast_chunks` (`embedding` as 1536-dim `dense_vector`) if missing. Without it, ES dynamic-maps `embedding` as plain floats and kNN breaks.
3. Populate with `cd auto-summarize && python main.py reindex` — uses `id=fullTitle`, backfills any missing enrichment fields, and chunks the `note` field.

Caveat: `seed-es.py`'s seeding loop is out of date — it chunks `content` (not `note`), uses random doc ids (duplicates with `reindex`), and overwrites the cached `embeddings` in the JSON. Prefer only its index-creation section, then `reindex`.

### Backend

All routes and middleware are defined directly in `src/app.js`. The service layer (`src/service.js`) holds all database logic and is the only file that talks to Elasticsearch and OpenAI. `dotenv` is loaded in `service.js`.

**Database: Elasticsearch only** (MongoDB was removed). Two indices:

- `podcast` — one doc per episode. `icu_analyzer` on `content`, `note`, `title`; `podcaster`, `episode`, `fullTitle`, `uploadDate` mapped as `keyword`. Enrichment fields are dynamically mapped, so stock queries use `mentioned_stocks.keyword`. `segments` is mapped `{ type: object, enabled: false }` (stored, not indexed) by `ensure_podcast_mapping()` in `main.py`; `search` and `summary` exclude it from `_source`.
- `podcast_chunks` — `{ fullTitle, podcaster, episode, uploadDate, chunk_index, content, embedding }`, used for kNN.

Timeline/aggregate queries (`themes`, `sentiment`, `stocks`, `glossary`) fetch with `size: 200` and aggregate in JS — bump this when the episode count approaches 200.

- **`src/middleware/verifyGoogleToken.js`** — validates Google OAuth Bearer tokens; sets `req.user`
- Rate limits (per `req.user.sub`, skipped when `NODE_ENV=test`): `/api/ask` + `/api/stock/ask` share a 20 req/day limiter; `/api/chat` has its own 30 req/day limiter

Route → Service call mapping:
| Route | Service function |
|---|---|
| `GET /api/search` | `search(keyword)` — BM25 full-text on `podcast` index |
| `GET /api/podcast/all` | `getPodcasts(page, limit)` — returns `title`, `uploadDate`, `episode`, `fullTitle`, `podcaster`, `note` |
| `GET /api/podcast/summary` _(auth)_ | `getPodcastByPodcasterAndEpisode(podcaster, episode)` |
| `GET /api/podcast/transcript` _(auth)_ | `getPodcastTranscript(podcaster, episode)` — returns `{ content, segments }` (`segments` is `null` for episodes without timestamps), 404 if missing |
| `GET /api/podcast/chunks` _(auth)_ | `getPodcastChunks(podcaster, episode, page)` — 10 chunks/page sorted by `chunk_index`; `{ chunks: [{ chunk_index, chunk_text }], total, page, hasMore }` |
| `POST /api/ask` _(auth, 20/day)_ | `askWithContext()` — embed → kNN on `podcast_chunks` → SSE |
| `POST /api/stock/ask` _(auth, shares 20/day)_ | `askAboutStock(ticker)` — AI opinion timeline for a ticker, SSE |
| `POST /api/chat` _(auth, 30/day)_ | `chatWithContext(question, messages)` — multi-turn RAG chat, SSE |
| `GET /api/themes/timeline` | `getThemesTimeline()` — `{ timeline: { "YYYY-MM": { theme: count } }, episodes }` |
| `GET /api/sentiment/timeline` | `getSentimentTimeline()` — per-episode `{ score, label, reason }` from `market_sentiment` |
| `GET /api/stocks` | `getStocksList()` — tickers aggregated from `mentioned_stocks` with first/last mention dates |
| `GET /api/stocks/:ticker` | `getStockDetail(ticker)` |
| `GET /api/stocks/:ticker/drift` | `getStockDrift(ticker)` — sentiment + matching bullish/bearish thesis per episode |
| `GET /api/glossary` | `getGlossary()` — `glossary_terms` aggregated by term across episodes |

All SSE endpoints share one protocol: first `data: { sources: [...] }`, then `data: { content }` chunks, finally `data: [DONE]` (or `data: { error }`).

### Frontend

Uses the Next.js App Router. State is managed globally with Redux Toolkit (`src/app/store.ts`) and persisted to `localStorage` via `redux-persist`. Persisted state can be stale/empty after a backend change — pages refetch when persisted data is empty.

**Key path alias:** `@/*` → `src/*`. Utils folder is at `src/utils/`.

**Redux slices** (`src/features/`):

- `searchSlice` — search results, driven by `fetchSearchResults(keyword)`
- `summarySlice` — episode summary + transcript (`transcript` text plus `transcriptSegments`, `null` when the episode has no timestamps); `fetchChunks` + `loadMoreChunks` fetch paginated chunks (kept for future use but not rendered)
- `podcastListSlice` — fetches all episodes at once (limit 200); the page component manages a local `visibleCount` for load-more (20 per step) and client-side year/month filtering
- `askSlice` — Q&A and stock-ask state (`question`, `answer`, `sources`, `status`); persisted so the answer survives navigation
- `chatSlice` — multi-turn chat messages
- `themesSlice`, `sentimentSlice`, `stocksSlice`, `glossarySlice` — data for the corresponding analytics pages
- `helloSlice` — legacy, not actively used

**Auth pattern:** `src/utils/fetchWithAuth.ts` wraps `fetch`, pulling the `id_token` from the NextAuth session and injecting `Authorization: Bearer <token>`. Any component calling a protected endpoint must use this utility. NextAuth is configured at `src/app/api/auth/[...nextauth]/route.ts`, with `authOptions` extracted to `src/lib/authOptions.ts`. The JWT callback auto-refreshes the Google ID token before expiry using the stored refresh token.

**Pages:**

- `/` — home
- `/search` — search interface
- `/podcast-list/[podcaster]` — episode list for a podcaster
- `/summary/[podcaster]/[episode]` — episode detail (auth-gated): 摘要 tab + 逐字稿 tab (keyword search; segments are merged into ~30s paragraphs with `[m:ss]` timestamps via `src/utils/transcript.ts`, plain text when an episode has none)
- `/ask` — Q&A streaming (auth-gated, 20/day) with a 查股票 tab for per-ticker opinion timelines
- `/chat` — multi-turn chat (auth-gated, 30/day)
- `/stocks`, `/stocks/[ticker]` — stock mention tracker and per-ticker detail with opinion drift
- `/themes` — theme trend timeline
- `/sentiment` — market sentiment timeline
- `/glossary` — investment concept glossary

### Mobile UI Notes

- Bottom nav height is `h-14` (56px) with `pb-safe` class for iPhone home indicator; `.pb-safe { padding-bottom: env(safe-area-inset-bottom) }` is defined in `globals.css`
- Each nav item has `min-h-[44px]` touch target
- Search result cards (`PodcastAccordians.tsx`): highlights default to `line-clamp-3 overflow-hidden`; per-card expand/collapse button with separate "查看集數 →" link to avoid tap conflicts
- All text inputs guard `onKeyDown` Enter with `e.nativeEvent.isComposing` to prevent IME (Chinese/Japanese/Korean) composition from triggering search prematurely
- Ko-fi link in footer (no copyright text)

### Testing

**Backend tests** (`backend/tests/`) use supertest against the real Express app with `vi.mock('../../src/service.js')` to stub the service layer. The `google-auth-library` mock uses `vi.hoisted()` to expose `mockVerifyIdToken` to the factory. There is one test file per route group in `tests/routes/`.

**Frontend tests** (`frontend/tests/`) use fresh `configureStore` instances (no redux-persist) per test. `summarySlice` tests mock `@/utils/fetchWithAuth` via `vi.hoisted()`. Only `search`, `summary`, `podcastList`, and `glossary` slices have tests so far.

No real network calls are made in any test — all external dependencies are mocked.

### Ingestion Pipeline (`auto-summarize/`)

Python pipeline that downloads, transcribes, enriches, and indexes new episodes. Uses the `openai-env/` virtualenv at the repo root.

```bash
cd auto-summarize
python tui.py              # Interactive TUI: diff RSS vs notes/, pick episodes, download + run full pipeline
python check_new.py        # List RSS episodes not yet in notes/gooaye/
python main.py local       # Process latest episode only (run-local.sh wraps this with logging to logs/)
python main.py reindex     # Re-index notes/gooaye/ into ES (always rebuilds chunks, backfills missing fields)
python main.py retranscribe [EP ...]  # Re-download + re-transcribe notes (default: all without `segments`)
python eval_asr.py <ep.mp3> --out data/asr_compare --clip 0:180   # Compare Whisper configs on clips; CER vs a hand-made reference.txt
```

**Flow:** Download via RSS (needs a browser User-Agent or the feed returns 403) → validate MP3 size → transcribe locally via `mlx-whisper` (`WHISPER_MODEL` = whisper-large-v3, Apple Silicon only, ~0.3–0.45× real time; turbo dropped phrases in `eval_asr.py`) keeping per-segment timestamps → OpenCC `s2tw` (not `s2twp`, whose phrase conversion rewrites words like 代碼→程式碼) + known misheard terms (`TRANSCRIPTION_FIXES`, incl. 臺→台) + half-width punctuation next to CJK widened → GPT-4o-mini summary → enrichment (`classify_themes`, `extract_stocks`, `extract_investment_thesis`, `extract_sentiment_score`, `extract_glossary_terms`) → sentence-boundary chunking (target 600 chars, hard cap 1500) of the `note` field → embed via `text-embedding-3-small` → write `podcast` + `podcast_chunks` → save JSON to `notes/gooaye/`.

In the TUI's full pipeline, the JSON is saved **before** any ES write, so an ES outage never loses transcription/summary work; a failed ES write only warns, and the index can be backfilled later with `main.py reindex`.

**`reindex` mode** always deletes and rebuilds `podcast_chunks` from the `note` field (re-embeds every chunk). Does not re-transcribe or re-summarize.

**`retranscribe` mode** downloads each episode's MP3 from RSS (all 700+ episodes are still in the feed) into `data/retranscribe/`, replaces only `content` + `segments` in the JSON, upserts the `podcast` doc, and deletes the MP3. `note`, enrichment and chunks are untouched. Changing `content` changes the transcript hash, so `analyze_company.py` will re-extract those episodes on its next run.

### Cross-episode company analysis (`auto-summarize/`, CLI only)

```bash
python analyze_company.py NVDA --range 1y         # quote only: which episodes are already analyzed + estimated cost
python analyze_company.py NVDA --range 1y --yes   # extract missing episodes, re-match threads, write the matrix page
```

- `companies.json` — company key → prompt name + extra aliases (misheard spellings). Add a company here before analyzing it.
- `extract_reasons.py` — per episode, LLM extracts self-contained reasons about the company from the raw `content` (whole episode in one gpt-5.5 call by default), each with a verbatim `reference` and `focus` (主角/背景).
- `match_threads.py` — groups reasons across episodes into neutral topic threads and labels each 新增/重複/更新/反轉 (gpt-5.5, one call per reason).
- `render_threads.py` — pure code; thread × episode matrix HTML.
- Records live in `analysis/<KEY>/extractions/EP*.json` (gitignored) with the transcript hash, prompt hash and model; an episode is re-extracted only when one of those changes. Zero-reason episodes are recorded too; failed calls are not. Thread matching is not cached yet and re-runs over the whole range, which dominates the quote.

### Environment Variables

Backend `backend/.env`:

```
ELASTIC_URL, ELASTIC_USERNAME, ELASTIC_PASSWORD
GOOGLE_CLIENT_ID
FRONTEND_URL
OPENAI_API_KEY   # used by /api/ask, /api/stock/ask, /api/chat for embeddings + GPT-4o-mini streaming
```

Frontend `frontend/.env`:

```
NEXT_PUBLIC_BACKEND_URL   # e.g. http://localhost:3000
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
NEXTAUTH_SECRET, NEXTAUTH_URL
```

Ingestion `auto-summarize/.env` (note the different names):

```
OPENAI_API_KEY
ELASTICSEARCH_HOST, ELASTICSEARCH_USERNAME, ELASTICSEARCH_PASSWORD
```

Root `.env` is read by `docker-compose.yml` (`ELASTIC_PASSWORD`, `ELASTIC_USERNAME`, `ELASTICSEARCH_SERVICEACCOUNTTOKEN`, `OPENAI_API_KEY`, Google/NextAuth secrets).
