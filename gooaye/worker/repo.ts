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
  cost_usd: number | null;
};

export function maxEpisodeNo(db: DB): number | null {
  return (db.prepare('SELECT MAX(episode_no) AS n FROM episodes').get() as { n: number | null }).n;
}

export function insertDiscovered(db: DB, ep: RssEpisode): boolean {
  const r = db
    .prepare(
      `INSERT INTO episodes (episode_no, guid, title, published_at, audio_url, duration)
       VALUES (@episodeNo, @guid, @title, @publishedAt, @audioUrl, @duration)
       ON CONFLICT DO NOTHING`,
    )
    .run(ep);
  return r.changes > 0;
}

export function getEpisode(db: DB, episodeNo: number): EpisodeRow | undefined {
  return db.prepare('SELECT * FROM episodes WHERE episode_no = ?').get(episodeNo) as EpisodeRow | undefined;
}

// Anything not done with retries left. A row stuck in transcribing/summarizing means
// the worker died mid-run; there is only one worker, so it is safe to pick up again.
export function workQueue(db: DB): EpisodeRow[] {
  return db
    .prepare(`SELECT * FROM episodes WHERE status != 'done' AND retries < ? ORDER BY episode_no`)
    .all(MAX_RETRIES) as EpisodeRow[];
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

export function markFailed(db: DB, id: number, error: string): number {
  const row = db
    .prepare(
      `UPDATE episodes SET status = 'failed', error = ?, retries = retries + 1,
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE id = ? RETURNING retries`,
    )
    .get(error.slice(0, 2000), id) as { retries: number };
  return row.retries;
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
           updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
         WHERE id = ? RETURNING cost_usd`,
      )
      .get(JSON.stringify(data.summary), data.costUsd, id) as { cost_usd: number };
    return row.cost_usd;
  })();
}
