import type { DB } from '@/lib/db.ts';
import { toVecBlob } from '@/lib/db.ts';
import type { Segment } from '@/lib/segments.ts';
import { STOCK_CATEGORY, type Summary } from '@/lib/summary.ts';
import type { Chunk } from './chunk.ts';
import { MAX_RETRIES } from './config.ts';
import type { RssEpisode } from './rss.ts';

export type EpisodeRow = {
  id: number;
  episode_no: number;
  guid: string;
  title: string;
  published_at: string;
  audio_url: string;
  duration: number | null;
  status: 'pending' | 'transcribing' | 'summarizing' | 'done' | 'failed';
  error: string | null;
  retries: number;
  segments_json: string | null;
  summary_draft_json: string | null;
  failed_step: Step | null;
  cost_usd: number | null;
  source: Source;
};

// rss: found by a poll (or added by a command); backfill: an older episode added by /backfill
export type Source = 'rss' | 'backfill';

export type Step = 'transcribe' | 'summarize' | 'embed';

export function maxEpisodeNo(db: DB): number | null {
  return (db.prepare('SELECT MAX(episode_no) AS n FROM episodes').get() as { n: number | null }).n;
}

export function insertDiscovered(db: DB, ep: RssEpisode, source: Source = 'rss'): boolean {
  const r = db
    .prepare(
      `INSERT INTO episodes (episode_no, guid, title, published_at, audio_url, duration, source)
       VALUES (@episodeNo, @guid, @title, @publishedAt, @audioUrl, @duration, @source)
       ON CONFLICT DO NOTHING`,
    )
    .run({ ...ep, source });
  return r.changes > 0;
}

// Feed audio URLs can change; a row not live yet takes the current one before a retry
export function setAudioUrl(db: DB, id: number, url: string): void {
  db.prepare(`UPDATE episodes SET audio_url = ? WHERE id = ? AND status != 'done'`).run(url, id);
}

export function getEpisode(db: DB, episodeNo: number): EpisodeRow | undefined {
  return db.prepare('SELECT * FROM episodes WHERE episode_no = ?').get(episodeNo) as EpisodeRow | undefined;
}

// Anything not done with retries left. A row stuck in transcribing/summarizing means
// the worker died mid-run; there is only one worker, so it is safe to pick up again.
// Newest first, so a new episode never waits behind retries of old ones. Backfilled episodes
// are left to the backfill, which resumes or re-offers them.
export function workQueue(db: DB): EpisodeRow[] {
  return db
    .prepare(`SELECT * FROM episodes WHERE status != 'done' AND retries < ? AND source = 'rss' ORDER BY episode_no DESC`)
    .all(MAX_RETRIES) as EpisodeRow[];
}

export type ProgressRow = Pick<EpisodeRow, 'episode_no' | 'status' | 'failed_step' | 'cost_usd'>;

// The rows of these episodes (those that exist), newest first: a backfill's progress
export function episodesIn(db: DB, nos: number[]): ProgressRow[] {
  return db
    .prepare(
      `SELECT episode_no, status, failed_step, cost_usd FROM episodes
       WHERE episode_no IN (SELECT value FROM json_each(?)) ORDER BY episode_no DESC`,
    )
    .all(JSON.stringify(nos)) as ProgressRow[];
}

// worker_state: small facts kept across restarts (the weekly digest, a backfill in progress)
export function getState(db: DB, key: string): string | null {
  return (db.prepare('SELECT value FROM worker_state WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
}

export function setState(db: DB, key: string, value: string): void {
  db.prepare('INSERT INTO worker_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
}

export function deleteState(db: DB, key: string): void {
  db.prepare('DELETE FROM worker_state WHERE key = ?').run(key);
}

export function episodeStatuses(db: DB): Map<number, Pick<EpisodeRow, 'status' | 'source'>> {
  const rows = db.prepare('SELECT episode_no, status, source FROM episodes').all() as Pick<EpisodeRow, 'episode_no' | 'status' | 'source'>[];
  return new Map(rows.map((r) => [r.episode_no, { status: r.status, source: r.source }]));
}

export function setStatus(db: DB, id: number, status: EpisodeRow['status']): void {
  db.prepare(`UPDATE episodes SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`).run(status, id);
}

// Saved before summarizing so a retry doesn't pay for transcription again
export function saveSegments(db: DB, id: number, segments: Segment[], duration: number, costUsd: number): void {
  db.prepare(
    `UPDATE episodes SET segments_json = ?, duration = ?, cost_usd = COALESCE(cost_usd, 0) + ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
     WHERE id = ?`,
  ).run(JSON.stringify(segments), Math.round(duration), costUsd, id);
}

// Saved before embedding so a later failure doesn't pay for the summary again
export function saveDraft(db: DB, id: number, summary: Summary, costUsd: number): void {
  db.prepare(
    `UPDATE episodes SET summary_draft_json = ?, cost_usd = COALESCE(cost_usd, 0) + ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
     WHERE id = ?`,
  ).run(JSON.stringify(summary), costUsd, id);
}

export function markFailed(db: DB, id: number, error: string, step: Step): number {
  const row = db
    .prepare(
      `UPDATE episodes SET status = 'failed', error = ?, failed_step = ?, retries = retries + 1,
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE id = ? RETURNING retries`,
    )
    .get(error.slice(0, 2000), step, id) as { retries: number };
  return row.retries;
}

// A failed re-run of a live episode keeps the live version and doesn't use up retries
export function recordError(db: DB, id: number, error: string, step: Step): void {
  db.prepare(
    `UPDATE episodes SET error = ?, failed_step = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`,
  ).run(error.slice(0, 2000), step, id);
}

export function recentEpisodes(db: DB, limit: number): EpisodeRow[] {
  return db.prepare('SELECT * FROM episodes ORDER BY episode_no DESC LIMIT ?').all(limit) as EpisodeRow[];
}

export function resetRetries(db: DB, id: number): void {
  db.prepare(`UPDATE episodes SET retries = 0 WHERE id = ? AND status != 'done'`).run(id);
}

// Replaces any earlier chunks and mentions, so re-running an episode is safe.
// Returns the episode's total cost so far.
export function publishEpisode(
  db: DB,
  id: number,
  data: { summary: Summary; chunks: Chunk[]; vectors: number[][]; costUsd: number },
): number {
  return db.transaction(() => {
    const old = db.prepare('SELECT id FROM chunks WHERE episode_id = ?').all(id) as { id: number }[];
    const delVec = db.prepare('DELETE FROM chunks_vec WHERE rowid = ?');
    for (const c of old) delVec.run(BigInt(c.id));
    db.prepare('DELETE FROM chunks WHERE episode_id = ?').run(id);
    db.prepare('DELETE FROM mentions WHERE episode_id = ?').run(id);

    const insChunk = db.prepare('INSERT INTO chunks (episode_id, idx, start_sec, text) VALUES (?, ?, ?, ?)');
    // sqlite-vec rejects rowids bound as JS numbers (better-sqlite3 sends REAL); use BigInt
    const insVec = db.prepare('INSERT INTO chunks_vec (rowid, embedding) VALUES (?, ?)');
    data.chunks.forEach((c, i) => {
      const { lastInsertRowid } = insChunk.run(id, c.idx, c.startSec, c.text);
      insVec.run(BigInt(lastInsertRowid), toVecBlob(data.vectors[i]!));
    });

    const insMention = db.prepare(
      'INSERT INTO mentions (episode_id, category, name, code, detail, quote, start_sec) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    for (const s of data.summary.stocks) insMention.run(id, STOCK_CATEGORY, s.name, s.code, s.note, null, s.t);
    for (const m of data.summary.mentions) insMention.run(id, m.category, m.name, null, null, m.quote, m.t);

    const row = db
      .prepare(
        `UPDATE episodes SET summary_json = ?, cost_usd = COALESCE(cost_usd, 0) + ?, status = 'done', error = NULL,
           summary_draft_json = NULL, failed_step = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
         WHERE id = ? RETURNING cost_usd`,
      )
      .get(JSON.stringify(data.summary), data.costUsd, id) as { cost_usd: number };
    return row.cost_usd;
  })();
}
