# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

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

Two separate Node.js apps — an Express backend and a Next.js frontend — that are developed and deployed independently.

- **Backend** (`backend/`): Express + TypeScript, ESM (`"type": "module"`), listens on port 3000
- **Frontend** (`frontend/`): Next.js 14 App Router + TypeScript, runs on port 3001

### Data Setup

The `podcast` Elasticsearch index is seeded from `notes/gooaye/*.json` (26 episodes). Each file contains `title`, `uploadDate`, `episode`, `fullTitle`, `podcaster`, `content`, `note`, and `embeddings` fields. Run this once after standing up Elasticsearch:

```bash
pip install "elasticsearch>=8,<9" python-dotenv
ELASTIC_URL=http://localhost:9200 ELASTIC_USERNAME=elastic ELASTIC_PASSWORD=<pw> python seed-es.py
```

The ES container installs the `analysis-icu` plugin on first start (Traditional Chinese tokenization) — wait ~60s before seeding.

### Backend

All routes and middleware are defined directly in `src/app.js`. The service layer (`src/service.js`) holds all database logic and is the only file that talks to Elasticsearch.

**Database: Elasticsearch only** — single `podcast` index with `icu_analyzer` on `content`, `note`, and `title` fields. Identifier fields (`podcaster`, `episode`, `fullTitle`, `uploadDate`) are mapped as `keyword`.

- **`src/middleware/verifyGoogleToken.js`** — validates Google OAuth Bearer tokens; applied to `/api/podcast/summary` and `/api/ask`

Route → Service call mapping:
| Route | Service function |
|---|---|
| `GET /api/search` | `search(keyword)` — BM25 full-text on `podcast` index |
| `GET /api/podcast/all` | `getPodcasts(page, limit)` |
| `GET /api/podcast/transcript` | `getPodcastTranscriptByPodcasterAndEpisode(podcaster, episode)` |
| `GET /api/podcast/summary` _(auth required)_ | `getPodcastByPodcasterAndEpisode(podcaster, episode)` |
| `POST /api/ask` _(auth required, 20 req/day/user)_ | `askWithContext()` — embed → kNN on `podcast_chunks` → GPT-4o-mini stream |

### Frontend

Uses the Next.js App Router. State is managed globally with Redux Toolkit and persisted to `localStorage` via `redux-persist`.

**Key path alias:** `@/*` → `src/*` (note: utils folder is spelled `src/utlis/` — typo in the codebase, keep consistent).

**Redux slices** (`src/features/`):

- `searchSlice` — search results, driven by `fetchSearchResults(keyword)`
- `summarySlice` — episode summary + transcript; has two independent status fields (`status` for summary, `transcriptStatus` for transcript)
- `podcastListSlice` — paginated podcast list; has a synchronous `setPage` action
- `helloSlice` — legacy, not actively used

**Auth pattern:** `src/utlis/fetchWithAuth.ts` wraps `fetch`, pulling the `id_token` from the NextAuth session and injecting `Authorization: Bearer <token>`. Any component calling a protected endpoint must use this utility. NextAuth is configured at `src/app/api/auth/[...nextauth]/route.ts`, with `authOptions` extracted to `src/lib/authOptions.ts`. The JWT callback auto-refreshes the Google ID token before expiry using the stored refresh token.

**Pages:**

- `/` — home
- `/search` — search interface
- `/podcast-list/[podcaster]` — episode list for a podcaster
- `/summary/[podcaster]/[episode]` — episode detail with summary (auth-gated) and transcript
- `/ask` — Q&A streaming interface (auth-gated, 20 req/day limit)

### Testing

**Backend tests** (`backend/tests/`) use supertest against the real Express app with `vi.mock('../../src/service.js')` to stub the service layer. The `google-auth-library` mock uses `vi.hoisted()` to expose `mockVerifyIdToken` to the factory.

**Frontend tests** (`frontend/tests/`) use fresh `configureStore` instances (no redux-persist) per test. `summarySlice` tests mock `@/utlis/fetchWithAuth` via `vi.hoisted()`.

No real network calls are made in any test — all external dependencies are mocked.

### Ingestion Pipeline (`auto-summarize/`)

Python script that downloads, transcribes, and indexes new episodes.

```bash
cd auto-summarize
python main.py test        # Process latest episode only (for testing)
python main.py production  # Process all new episodes
python main.py reindex     # Re-index from notes/gooaye/ into ES (safe to re-run)
```

**Flow:** Download via RSS → check `notes/gooaye/` for duplicates → Whisper transcription (splits audio only if > 24MB) → GPT-4o-mini summary → sentence-boundary chunking (target 600 chars, hard cap 1500) → embed via `text-embedding-3-small` → write to `podcast` + `podcast_chunks` → cache embeddings back to `notes/gooaye/*.json`.

**`reindex` mode** skips episodes already in ES that also have cached embeddings in their JSON. Useful for recovering from partial failures without re-calling OpenAI.

### Environment Variables

Backend `.env`:

```
ELASTIC_URL, ELASTIC_USERNAME, ELASTIC_PASSWORD
GOOGLE_CLIENT_ID
FRONTEND_URL
OPENAI_API_KEY   # used by /api/ask for embeddings + GPT-4o-mini streaming
```

Frontend `.env.local`:

```
NEXT_PUBLIC_BACKEND_URL   # e.g. http://localhost:3000
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
NEXTAUTH_SECRET
```
