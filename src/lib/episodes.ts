import { cache } from 'react';
import { countLiveEpisodes, hasColumn } from './db.ts';
import type { Segment } from './segments.ts';
import { parseSeekTable, type SeekTable } from './seek.ts';
import { readDb } from './server-db.ts';
import type { Summary } from './summary.ts';

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
  // null: not worked out yet, or nothing to correct
  seek: SeekTable | null;
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

// For links to an episode (上一集 / 下一集, related ones), which show no stocks: their
// subquery parses every summary's stocks for nothing
const LINK_COLUMNS = `episode_no, title, published_at, duration,
  json_extract(summary_json, '$.line') AS line, NULL AS stocks`;

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

// Cached per request: the home page's metadata and body both need it
export const countEpisodes = cache(async (): Promise<number> => countLiveEpisodes(await readDb()));

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
    .prepare(
      `SELECT ${LIST_COLUMNS}, audio_url, summary_json, segments_json, ${hasColumn(d, 'episodes', 'seek_json') ? 'seek_json' : 'NULL AS seek_json'}
       FROM episodes WHERE status = 'done' AND episode_no = ?`,
    )
    .get(no) as (ListRow & { audio_url: string; summary_json: string; segments_json: string | null; seek_json: string | null }) | undefined;
  if (!r) return null;
  return {
    ...toListItem(r),
    audioUrl: r.audio_url,
    summary: JSON.parse(r.summary_json) as Summary,
    segments: r.segments_json ? (JSON.parse(r.segments_json) as Segment[]) : [],
    seek: parseSeekTable(r.seek_json),
  };
});

// The live episodes either side of one by number, for 上一集 / 下一集: the nearest ones, so a
// gap in the numbers (an episode not live yet) is stepped over
export async function adjacentEpisodes(no: number): Promise<{ prev: EpisodeListItem | null; next: EpisodeListItem | null }> {
  const d = await readDb();
  const one = (sql: string) => {
    const r = d.prepare(sql).get(no) as ListRow | undefined;
    return r ? toListItem(r) : null;
  };
  return {
    prev: one(`SELECT ${LINK_COLUMNS} FROM episodes WHERE status = 'done' AND episode_no < ? ORDER BY episode_no DESC LIMIT 1`),
    next: one(`SELECT ${LINK_COLUMNS} FROM episodes WHERE status = 'done' AND episode_no > ? ORDER BY episode_no ASC LIMIT 1`),
  };
}

// Live episodes by number, in the order asked for; ones not live are left out
export async function episodesByNo(nos: number[]): Promise<EpisodeListItem[]> {
  if (nos.length === 0) return [];
  const d = await readDb();
  const rows = d
    .prepare(`SELECT ${LINK_COLUMNS} FROM episodes WHERE status = 'done' AND episode_no IN (${nos.map(() => '?').join(', ')})`)
    .all(...nos) as ListRow[];
  const byNo = new Map(rows.map((r) => [r.episode_no, toListItem(r)]));
  return nos.flatMap((n) => byNo.get(n) ?? []);
}

// The [no] segment of /ep/[no]
export function parseEpisodeNo(raw: string): number | null {
  return /^\d{1,5}$/.test(raw) ? Number(raw) : null;
}

// Without loading the transcript: the episode layout runs on every prefetch of an episode link
export async function episodeExists(no: number): Promise<boolean> {
  const d = await readDb();
  return d.prepare(`SELECT 1 FROM episodes WHERE status = 'done' AND episode_no = ?`).get(no) !== undefined;
}

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

// Every live episode for sitemap.xml, dated by its release. updated_at would be wrong:
// failed re-runs bump it on a live episode without changing what the page shows.
export async function sitemapEpisodes(): Promise<{ no: number; publishedAt: string }[]> {
  const d = await readDb();
  return (
    d.prepare(`SELECT episode_no, published_at FROM episodes WHERE status = 'done' ORDER BY episode_no DESC`).all() as {
      episode_no: number;
      published_at: string;
    }[]
  ).map((r) => ({ no: r.episode_no, publishedAt: r.published_at }));
}
