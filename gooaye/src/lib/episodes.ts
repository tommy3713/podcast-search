import { connection } from 'next/server';
import { cache } from 'react';
import { type DB, defaultDbPath, openDb } from './db.ts';
import type { Segment } from './segments.ts';
import type { Summary } from './summary.ts';

// Web requests only read. The worker is the single writer; WAL lets both run at once.
let db: DB | undefined;
async function readDb(): Promise<DB> {
  // better-sqlite3 is synchronous, so without this the queries would run at build time
  await connection();
  return (db ??= openDb(defaultDbPath(), { readonly: true }));
}

export type EpisodeListItem = {
  no: number;
  title: string;
  publishedAt: string;
  duration: number | null;
  line: string;
  stocks: string[];
};

export type EpisodeDetail = EpisodeListItem & {
  audioUrl: string;
  summary: Summary;
  segments: Segment[];
};

type ListRow = {
  episode_no: number;
  title: string;
  published_at: string;
  duration: number | null;
  line: string | null;
  stocks: string | null;
};

const LIST_COLUMNS = `episode_no, title, published_at, duration,
  json_extract(summary_json, '$.line') AS line,
  (SELECT json_group_array(json_extract(s.value, '$.name')) FROM json_each(summary_json, '$.stocks') s) AS stocks`;

function toListItem(r: ListRow): EpisodeListItem {
  return {
    no: r.episode_no,
    title: r.title,
    publishedAt: r.published_at,
    duration: r.duration,
    line: r.line ?? '',
    stocks: r.stocks ? (JSON.parse(r.stocks) as string[]) : [],
  };
}

export async function countEpisodes(): Promise<number> {
  const d = await readDb();
  return (d.prepare(`SELECT COUNT(*) AS n FROM episodes WHERE status = 'done'`).get() as { n: number }).n;
}

// Newest first
export async function listEpisodes(limit: number, offset: number): Promise<EpisodeListItem[]> {
  const d = await readDb();
  const rows = d
    .prepare(`SELECT ${LIST_COLUMNS} FROM episodes WHERE status = 'done' ORDER BY episode_no DESC LIMIT ? OFFSET ?`)
    .all(limit, offset) as ListRow[];
  return rows.map(toListItem);
}

// cache(): generateMetadata and the page both ask for the same episode in one request
export const getEpisode = cache(async (no: number): Promise<EpisodeDetail | null> => {
  const d = await readDb();
  const r = d
    .prepare(`SELECT ${LIST_COLUMNS}, audio_url, summary_json, segments_json FROM episodes WHERE status = 'done' AND episode_no = ?`)
    .get(no) as (ListRow & { audio_url: string; summary_json: string; segments_json: string | null }) | undefined;
  if (!r) return null;
  return {
    ...toListItem(r),
    audioUrl: r.audio_url,
    summary: JSON.parse(r.summary_json) as Summary,
    segments: r.segments_json ? (JSON.parse(r.segments_json) as Segment[]) : [],
  };
});

export async function latestEpisodeNo(): Promise<number | null> {
  const d = await readDb();
  return (d.prepare(`SELECT MAX(episode_no) AS n FROM episodes WHERE status = 'done'`).get() as { n: number | null }).n;
}

export async function oldestEpisodeNo(): Promise<number | null> {
  const d = await readDb();
  return (d.prepare(`SELECT MIN(episode_no) AS n FROM episodes WHERE status = 'done'`).get() as { n: number | null }).n;
}

// 0 for the newest episode
export async function episodeIndex(no: number): Promise<number> {
  const d = await readDb();
  return (d.prepare(`SELECT COUNT(*) AS n FROM episodes WHERE status = 'done' AND episode_no > ?`).get(no) as { n: number }).n;
}
