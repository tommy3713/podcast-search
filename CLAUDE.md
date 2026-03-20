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

### Backend

All routes and middleware are defined directly in `src/app.js`. The service layer (`src/service.js`) holds all database logic and is the only file that talks to Elasticsearch.

**Database: Elasticsearch only** (no MongoDB) — two indices:
- `podcast_episodes` — BM25 full-text search and episode summaries
- `podcast_chunks` — kNN vector search; chunks are 400 tokens with 80-token overlap, embedded with `text-embedding-3-small`

- **`src/middleware/verifyGoogleToken.js`** — validates Google OAuth Bearer tokens; applied only to `/api/podcast/summary`

Route → Service call mapping:
| Route | Service function |
|---|---|
| `GET /api/search` | `search(keyword)` — BM25 on `podcast_episodes` |
| `GET /api/podcast/all` | `getPodcasts(page, limit)` |
| `GET /api/podcast/transcript` | `getPodcastTranscriptByPodcasterAndEpisode(podcaster, episode)` |
| `GET /api/podcast/summary` *(auth required)* | `getPodcastByPodcasterAndEpisode(podcaster, episode)` |
| `POST /api/ask` | Streaming response — GPT-4o-mini over kNN results from `podcast_chunks` |

### Frontend

Uses the Next.js App Router. State is managed globally with Redux Toolkit and persisted to `localStorage` via `redux-persist`.

**Key path alias:** `@/*` → `src/*` (note: utils folder is spelled `src/utlis/` — typo in the codebase, keep consistent).

**Redux slices** (`src/features/`):
- `searchSlice` — search results, driven by `fetchSearchResults(keyword)`
- `summarySlice` — episode summary + transcript; has two independent status fields (`status` for summary, `transcriptStatus` for transcript)
- `podcastListSlice` — paginated podcast list; has a synchronous `setPage` action
- `helloSlice` — legacy, not actively used

**Auth pattern:** `src/utlis/fetchWithAuth.ts` wraps `fetch`, pulling the `id_token` from the NextAuth session and injecting `Authorization: Bearer <token>`. Any component calling a protected endpoint must use this utility. NextAuth is configured at `src/app/api/auth/[...nextauth]/route.ts`.

**Pages:**
- `/` — home
- `/search` — search interface
- `/podcast-list/[podcaster]` — episode list for a podcaster
- `/summary/[podcaster]/[episode]` — episode detail with summary (auth-gated) and transcript

### Testing

**Backend tests** (`backend/tests/`) use supertest against the real Express app with `vi.mock('../../src/service.js')` to stub the service layer. The `google-auth-library` mock uses `vi.hoisted()` to expose `mockVerifyIdToken` to the factory.

**Frontend tests** (`frontend/tests/`) use fresh `configureStore` instances (no redux-persist) per test. `summarySlice` tests mock `@/utlis/fetchWithAuth` via `vi.hoisted()`.

No real network calls are made in any test — all external dependencies are mocked.

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
