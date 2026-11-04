# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

股癌搜尋 (https://gooaye-notes.com): an unofficial site with per-episode summaries, timestamped transcripts and cross-episode Q&A for the podcast《股癌 Gooaye》. One package: a Next.js app (`src/`) and an ingest worker (`worker/`) sharing one SQLite database.

The v1 stack (Express + Elasticsearch backend, Next 14 frontend, Python ingestion, k8s/EC2) was removed; it lives at tag `v1-es-final`. The v1 episode JSON is kept locally in gitignored `notes/gooaye/`.

## Commands

```bash
npm run dev          # web on :3005 against data/dev.db (DB_PATH overrides)
npm run dev:seed     # fill data/dev.db from scripts/fixtures (no API calls)
npm run db:pull      # snapshot the live database to data/prod.db (over ssh)
npm test             # vitest, all tests
npx vitest run tests/ask.test.ts
npm run typecheck
npm run build
npm run check        # typecheck + test + deploy script smoke test + build; run before every push

npm run worker -- status                 # episode statuses and costs
npm run worker -- poll                   # check RSS once and process new episodes
npm run worker -- ingest 709 [--resummarize|--retranscribe] [--segments-file f]
npm run worker -- seed 10                # process the latest n episodes
npm run worker -- nightly                # purge old ask logs, back up to R2, check episode count and disk
npm run worker -- check-db data/restore.db   # integrity check of a database (restore drill, deploy/restore.md)
npm run worker -- run                    # scheduler + Telegram bot (production entry point)
tsx --env-file=.env.local scripts/ask-cli.ts "問題"   # Q&A from the terminal, no quota
```

## Workflow

`main` only changes through pull requests merged on GitHub: a ruleset rejects direct pushes, and the `check`, `image (web)` and `image (worker)` checks must pass. Never commit to `main` locally.

1. Branch from an up-to-date main: `git switch main && git pull && git switch -c feat/<topic>` (prefixes `feat/`, `fix/`, `chore/`, `docs/`).
2. Before pushing: `npm run check`, then try the change in `npm run dev` (fixtures) or `DB_PATH=data/prod.db npm run dev` (live snapshot, `npm run db:pull` first). Untested UI or worker changes don't go in a PR.
3. Run `/code-review` on the diff and fix what it finds.
4. `git push -u origin <branch>`, `gh pr create` (fill in `.github/pull_request_template.md`: how it was tested, whether the worker or `deploy/` changed). The PR title becomes the squash commit on main, so write it as a conventional commit (`feat: ...`, `fix: ...`). Then stop: don't merge or enable auto-merge. The owner reviews and merges on GitHub.
5. Merging deploys automatically (see Deploy); the result arrives in Telegram. Then `git switch main && git pull`.

## Environments

- **Production** is the VPS. `deploy/compose.yml` sets `APP_ENV=production`; secrets are in `/opt/gooaye/web.env` and `worker.env`.
- **Local dev** is everything else: no `APP_ENV`, secrets in gitignored `.env.local` (see `.env.example`). `src/lib/env.ts` `isProduction()` gates what must only happen live: R2 backups are skipped, Telegram messages are prefixed `🧪 DEV`, and the header shows a DEV badge.
- Local keys must be dev-only: an OpenAI project key with its own budget, a separate Telegram bot (only one process may poll a bot, and production's worker already polls the live one), no R2 credentials.
- Databases: `data/dev.db` (fixtures, `npm run dev:seed`) or `data/prod.db`, a snapshot of the live database without `ask_log` / `ask_usage` (`npm run db:pull`, then `DB_PATH=data/prod.db npm run dev` or `DB_PATH=data/prod.db npm run worker -- ...`). Nothing local ever writes to the live database.

`.npmrc` sets `legacy-peer-deps`; vitest is pinned to 4.x because npm 10.9 crashes on vitest 5's peers. Dependencies use exact versions.

## Architecture

### Database (`src/lib/db.ts`)

SQLite via better-sqlite3 plus the sqlite-vec extension; migrations run in `openDb(..., { migrate: true })`, which only the worker does. Tables: `episodes` (status `pending → transcribing → summarizing → done | failed`, `segments_json`, `summary_json`, `summary_draft_json`, `failed_step`, `cost_usd`), `chunks` + `chunks_fts` (FTS5 trigram) + `chunks_vec` (vec0, 1536 dims), `mentions` (category, name, code, detail, quote, start_sec), `ask_usage`, `ask_log` (question, answer, `outcome`, cited sources, tool calls, ms, tokens, cost; purged after 30 days), `ask_daily` (per-day totals rolled up from `ask_log`, kept forever), `worker_state` (key/value the worker keeps across restarts).

vec0 rowids must be bound as `BigInt`. Trigram FTS needs 3+ characters, so shorter search terms fall back to `LIKE` (`src/lib/ask/search.ts`).

The web reads through `readDb()` (readonly) and writes only `ask_usage` / `ask_log` through `writeDb()` (`src/lib/server-db.ts`).

### Worker (`worker/`)

`pipeline.ts` processes one episode in three checkpointed steps, each saved before the next starts, so a retry resumes from `failed_step` and never pays for a finished step twice:

1. **Transcribe** (`audio.ts`, `transcribe.ts`): download from RSS (needs a browser-like User-Agent or SoundOn returns 403), compress and split with ffmpeg, Groq `whisper-large-v3`. Gaps of 12 s+ in the result are re-transcribed on their own (Groq drops windows); a window counts as silence only when `no_speech_prob > 0.6` and `avg_logprob < -1`. `text.ts` converts with OpenCC `s2tw` (not `s2twp`) and applies known misheard-term fixes.
2. **Summarize** (`summarize.ts`): one gpt-5.5 call → `LlmSummary` (zod, `src/lib/summary.ts`): one-line summary, key points, chapters, stocks, mentions (food, sports, travel, media, games, products). `sanitizeSummary` caps lengths and drops out-of-range timestamps. Ads and non-investment brands are kept out of `stocks`.
3. **Embed and publish** (`chunk.ts`, `embed.ts`, `repo.ts`): ~600-character chunks on segment boundaries (adjacent chunks share a segment), `text-embedding-3-small`, then one transaction that swaps the episode live. Re-running a live episode keeps the old version visible until the new one publishes; a failed re-run leaves it untouched.

`schedule.ts`: RSS is polled every 30 min, 10:00–23:30 Taipei, on Wednesdays and Saturdays (release days); `nightly` runs at 03:00 (ask-log purge after 30 days, gzip backup to R2 under `backups/`, deleted by a bucket lifecycle rule after 30 days).

Monitoring (`monitor.ts`, `backup.ts`): the worker's own Telegram messages can't report the worker or the VPS being down, so external services watch too. A 30-minute timer pings `HC_HEARTBEAT_URL` (Healthchecks.io) unless the shared job queue has had one job running over 2 h (`MAX_JOB_MS`), so a dead process, a blocked event loop and a hung job (scheduled or from Telegram) all stop the heartbeat. Nightly checks free disk (below both 15% and 10 GB) and the live episode count against the highest seen (`<DB_PATH>.backup-state.json`; a drop is reported every night until that file is deleted), then backs up after `integrity_check` on the copy; any problem goes to Telegram and `HC_BACKUP_URL/fail`, success pings `HC_BACKUP_URL`. The worker posts `🔄 worker 已啟動` on every start. UptimeRobot checks the homepage for a keyword from outside. Pings never throw. Restore drill and procedure: `deploy/restore.md`.

Q&A stats (`stats.ts`): nightly rolls `ask_log` up into `ask_daily` before the purge (last 28 finished days only, so a thinned-out day is never rewritten); rows without an `outcome` (from before it was recorded) are left out. Telegram `/stats [days]` and a weekly digest (due from Monday 09:00 until sent; the week is remembered in `worker_state`) show outcome counts, cost, average time and the questions answered without a source.

`bot.ts`: Telegram commands `/status`, `/poll`, `/retry N`, `/resummarize N`, `/retranscribe N`, `/stats [days]`, `/questions [n]` (recent Q&A; `ask:<id>` buttons send one question with its answer, searches and cost), and inline buttons (`action:N`). Only `TELEGRAM_CHAT_ID` is obeyed. All jobs run one at a time through `enqueue` in `actions.ts`. Success and failure notifications include the episode's running cost.

### Web (`src/app`)

- `/` episode list (20 per page, `?ep=` jumps to an episode), `/ep/[no]` summary + transcript (`?t=` seconds jumps the player and transcript, `?tab=tx`), `/ask`, `/about`.
- Loading screens: `/` (in the `(home)` route group), `/ep/[no]` and `/ask` have a `loading.tsx` skeleton (`src/components/Skeleton.tsx`), which links prefetch, so a click shows it at once. It makes the page stream, and once the skeleton is sent the status is fixed at 200: so `ep/[no]/layout.tsx` checks the episode exists (above the skeleton) to keep real 404s, and there is no root `loading.tsx` (it would wrap that layout too). Accepted costs: a direct load shows the skeleton for ~300 ms (React batches streamed reveals; measured LCP +0.3 s on `/` and `/ep`), and `/?ep=` redirects with a 200 and a client/meta-refresh redirect instead of a 307.
- SEO (`src/lib/seo.ts`): episode titles are a single emoji, so `<title>` is `股癌 EP<n>｜<summary line>` (absolute, no site suffix) and the description is the line plus two key points, capped at 150 characters. Every page has a canonical URL (`?t=` / `?tab=` collapse to `/ep/<n>`, list pages keep `?page=`). Both episode tabs render on the server (the inactive one `hidden`) so the transcript is in the HTML (about +60 KB raw per episode, also sent in the RSC payload; accepted); the hidden transcript panel is memoized and gets no playback time, so it neither re-renders nor scrolls. `sitemap.ts` lists live episodes from the database per request, dated by release (`updated_at` also moves on failed re-runs); `robots.ts` blocks training-only AI crawlers and `/api/`, and Cloudflare prepends its content-signal comments. `/ask` is `noindex`. The share image is `app/opengraph-image.png` (source and render script in `scripts/og-image/`; X falls back to it); pages that set their own `openGraph` must list `SHARE_IMAGE` (use `shareMetadata()`), since that stops the file-based image from being inherited. The tab icon is `app/icon.svg`; `app/favicon.ico` and `app/apple-icon.png` are rendered from it by `scripts/favicon/render.sh` (rerun it after editing the SVG). Episode JSON-LD escapes `<` because summaries come from untrusted transcripts.
- `/api/ask` (SSE): JSON content type and same-origin check → Google login (next-auth, JWT keeps only `sub` and name) → zod (≤300 chars) → quota (20 per user and 500 site-wide per Taipei day, charged up front, refunded only if nothing streamed) → OpenAI moderation → `answer()`. 30 s timeout; every request past login, including quota rejections, is logged to `ask_log` (`logAsk` never throws). `outcome` is `answered` when the final answer cites a source and `no_source` when it cites none (how out-of-scope questions show up); `AnswerRecorder` (`src/lib/ask/record.ts`) follows the streamed events and counts citations with the page's own `parseAnswer`. Token use comes from the `AskTrace` that `answer()` fills in (only finished model turns report usage, so a timed-out or aborted request's cost is a lower bound); prices and `askCost` are in `src/lib/cost.ts`, shared with the worker. Only the first quota rejection per user per Taipei day is logged (`logQuotaRejection`).
- `src/lib/ask/agent.ts`: Responses API tool loop (`ASK_MODEL`, default gpt-5.4-mini; at most 4 tool calls; `store: false` with encrypted reasoning passed back). Tools `search_transcript` (keyword + vector, RRF) and `search_mentions`. The server numbers sources; the model may only cite `[n]`, and `render.ts` drops unknown numbers and allows only `- ` lists and `**bold**`. `toInputItem` strips the SDK's `parsed_arguments` / `parsed` fields, which the API rejects as input.

### Prompt-safety rules (keep these when editing prompts)

- System prompt holds rules and server facts only; user input goes in the user role inside `<question>`, never concatenated into the system prompt. Transcripts are untrusted too (listener messages are read on air): tool results are wrapped in `<transcript>` / `<mention>` with `<>` escaped to full-width (`escapeTags`), and the prompt says tag contents are data. The most important rules go last.
- No market-sentiment tags, no bullish/bearish or 正面/負面/樂觀/保守 labels, no investment advice: only report what the host said and let listeners judge.

## Deploy

- Traffic reaches the VPS only through Cloudflare. DNS for `gooaye-notes.com` and `www` is proxied (orange cloud), A records only (no AAAA: visitors still get IPv6 at Cloudflare's edge, and the VPS's IPv6 stays out of DNS). SSL/TLS mode is **Full (strict)**, so Cloudflare verifies Caddy's Let's Encrypt certificate. **Always Use HTTPS is off** on purpose: Cloudflare forwards plain HTTP to Caddy, which answers ACME HTTP-01 challenges on port 80 and redirects everything else to HTTPS itself.
- A Vultr Firewall Group (outside the VM, so Docker can't bypass it the way it bypasses ufw) allows only TCP 80/443 from Cloudflare's ranges and TCP 22 from anywhere (SSH is key-only, root login disabled; GitHub Actions and a changing home IP need it). No IPv6 rules, so all inbound IPv6 is dropped. Connecting to the VPS IP directly on 80/443 times out; that is expected.
- Vultr VPS (Ubuntu 24.04, 1 vCPU / 2 GB). `/opt/gooaye` holds `compose.yml`, `web.env`, `worker.env` (chmod 600) and `data/app.db`; containers `web` and `worker`, no published ports.
- Caddy is shared by every app on the VPS: its own compose project in `/opt/proxy` (`deploy/proxy/`, deployed with `deploy/proxy/deploy.sh`; `deploy/proxy/README.md` explains how an app joins it), the only container that publishes ports (80/443, reachable only from Cloudflare). Apps join the external docker network `proxy` under a unique alias (web is `gooaye-web`) and own their site blocks in `/opt/proxy/sites/<app>.caddy`; gooaye's is `deploy/gooaye.caddy` (TLS, security headers, www → apex), installed by `deploy/remote-deploy.sh` on each deploy.
- `.github/workflows/ci.yml` runs typecheck and tests, then builds both `Dockerfile` targets, on every PR (images not pushed) and on every merge to `main`, which pushes `ghcr.io/tommy3713/gooaye-{web,worker}` (`:latest` and `:<sha>`). Never build on the VPS.
- Merging to `main` deploys automatically: `ci.yml`'s `deploy` job calls `.github/workflows/deploy.yml` (also runnable by hand from the Actions tab with a commit sha, which is how to roll back). It SSHes in with a key whose `authorized_keys` entry is `restrict,command="/opt/gooaye/bin/deploy-hook"`, so the only input is a sha: `deploy/deploy-hook.sh` checks the commit is on main, then runs `deploy/remote-deploy.sh` from that commit. The key and the VPS host key are secrets of the `vps` GitHub environment (host in its `DEPLOY_HOST` variable), which only `main` may use. Rollbacks only reach commits that contain `deploy/remote-deploy.sh`; to go further back, revert in a PR.
- `remote-deploy.sh <sha>`: fetch and validate `compose.yml` + `gooaye.caddy` at the sha, pull images `:<sha>`, run `worker migrate` with the new image, replace web, reload Caddy, check the homepage from the VPS through Caddy without Cloudflare (`curl --resolve gooaye-notes.com:443:127.0.0.1`, 200 and `id="ep-list"` in the body, 12 tries 5 s apart; the episode list rather than the brand, because the page streams and the header and footer say 股癌 with a 200 even when the database is broken), then replace the worker once its queue is idle and it's not within a minute or two of a :00/:30 scheduler slot (the worker writes `data/app.db.queue.json` with `running` and `waiting`; without it, episodes mid-pipeline count as busy; waits up to 60 min, otherwise leaves the old worker and says so), keep the images web and the worker run plus the previous deploy's, write `TAG=<sha>` to `/opt/gooaye/.env` so manual `docker compose` commands use the deployed release, and report to Telegram with the worker's bot. A failure (including the site check) puts the previous compose file, Caddy site (reloaded) and web back, leaves `.env` on the previous `TAG`, checks the site again and reports the step and whether the old version answers; the workflow then fails. `.prev` files left by a deploy that was killed mid-way are deleted at the start, never restored. The public path through Cloudflare is watched by UptimeRobot, not by the deploy.
- **Migrations must work with the previous release**: they run before web is replaced, and the old worker may keep running on the new schema for up to an hour. Add columns and tables; never rename or drop in the same release.
- `deploy/deploy.sh [sha]` deploys by hand with your own key (default: the newest commit on main that has images), running this checkout's `remote-deploy.sh`, so a change to it can be tried before merging. It also installs `deploy-hook` on the VPS.
- `.dockerignore` is an allowlist; add new top-level source directories to it. `next.config.ts` forces sqlite-vec's platform package into the standalone output (tracing can't see it) and excludes `data/` and `.env*`.
- Never prefix secrets with `NEXT_PUBLIC_`.

## Testing

`tests/` covers RSS parsing, text cleanup, summary validation, scheduling, repo/pipeline checkpoints, web helpers, Q&A search/render, backup, and monitoring (pings, disk, backup checks). Tests use in-memory SQLite and stub every network call (OpenAI, Groq, Telegram, R2). `tests/remote-deploy.test.sh` runs `deploy/remote-deploy.sh` end to end against stub `docker`/`curl`, succeeding, rolled back after a failed site check (an error, or a 200 without the episode list; with the old release answering and not), and failing early next to an interrupted deploy's leftovers (part of `npm run check` and CI); run it after any change to the deploy scripts.
