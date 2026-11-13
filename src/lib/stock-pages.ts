import type { DB } from './db.ts';
import { appendSegment, monthKey } from './format.ts';
import type { Segment } from './segments.ts';
import { readDb } from './server-db.ts';
import { buildStockIndex, type EpisodeOutline, type StockIndex, type StockRow } from './stocks.ts';
import { STOCK_CATEGORY, type Summary } from './summary.ts';

// Live episodes' stock rows, newest episode first
export function stockRows(db: DB): StockRow[] {
  return db
    .prepare(
      `SELECT m.name, m.code, m.detail, m.start_sec AS startSec, e.episode_no AS episodeNo, e.title, e.published_at AS publishedAt
       FROM mentions m JOIN episodes e ON e.id = m.episode_id
       WHERE m.category = ? AND e.status = 'done'
       ORDER BY e.episode_no DESC, m.start_sec, m.id`,
    )
    .all(STOCK_CATEGORY) as StockRow[];
}

// Live episodes' chapters and key points, for the chapter titles and depth on a stock's page
export function episodeOutlines(db: DB): Map<number, EpisodeOutline> {
  const rows = db.prepare(`SELECT episode_no, summary_json FROM episodes WHERE status = 'done' AND summary_json IS NOT NULL`).all() as {
    episode_no: number;
    summary_json: string;
  }[];
  const outlines = new Map<number, EpisodeOutline>();
  for (const r of rows) {
    // Every page reads this, so one episode's broken summary must cost only its own outline
    try {
      const s = JSON.parse(r.summary_json) as Partial<Summary>;
      const chapters = Array.isArray(s.chapters) ? s.chapters : [];
      outlines.set(r.episode_no, {
        chapters: chapters.map((c) => ({ t: c.t, title: c.title ?? '', ad: !!c.ad, bullets: Array.isArray(c.bullets) ? c.bullets : [] })),
        keys: Array.isArray(s.keys) ? s.keys : [],
      });
    } catch {
      // Left out: its stock notes show without chapters
    }
  }
  return outlines;
}

const EXCERPT_LEAD_SEC = 15;
const EXCERPT_CHARS = 450;

// The transcript from a little before a timestamp, about 450 characters: the summary's
// timestamps are where he starts on something, and its first words are the ones wanted.
// Joined the way the transcript tab joins segments.
export function excerptFrom(segments: Segment[], t: number): { t: number; text: string } | null {
  let first = segments.findIndex((s) => s.start >= t - EXCERPT_LEAD_SEC);
  // Past the last segment: the tail
  if (first === -1) first = Math.max(0, segments.length - 1);
  let text = '';
  for (const seg of segments.slice(first)) {
    if (text.length >= EXCERPT_CHARS) break;
    text = appendSegment(text, seg.text);
  }
  return text ? { t: Math.floor(segments[first]!.start), text } : null;
}

export function excerptAt(db: DB, episodeNo: number, t: number): { t: number; text: string } | null {
  const row = db.prepare(`SELECT segments_json FROM episodes WHERE episode_no = ? AND status = 'done'`).get(episodeNo) as
    | { segments_json: string | null }
    | undefined;
  return row?.segments_json ? excerptFrom(JSON.parse(row.segments_json) as Segment[], t) : null;
}

// Every episode page needs the index for its links, so it is built once and kept until an
// episode is published, re-run or taken down: each of those moves the count of live episodes
// or their newest updated_at. Not PRAGMA data_version, which every logged question moves too.
let cached: { version: string; index: StockIndex; liveMonths: Map<string, number> } | undefined;

// Live episodes per month (Taipei), for the chart on a stock's page
export function liveMonths(db: DB): Map<string, number> {
  const months = new Map<string, number>();
  const rows = db.prepare(`SELECT published_at FROM episodes WHERE status = 'done'`).all() as { published_at: string }[];
  for (const r of rows) months.set(monthKey(r.published_at), (months.get(monthKey(r.published_at)) ?? 0) + 1);
  return months;
}

// The index and the months of one moment: read apart, a publish in between could leave a
// stock with an episode in a month the chart doesn't have
export async function stockData(): Promise<{ index: StockIndex; liveMonths: Map<string, number> }> {
  const d = await readDb();
  const v = d.prepare(`SELECT COUNT(*) AS n, MAX(updated_at) AS at FROM episodes WHERE status = 'done'`).get() as { n: number; at: string | null };
  const version = `${v.n} ${v.at}`;
  if (cached?.version !== version) cached = { version, index: buildStockIndex(stockRows(d), episodeOutlines(d)), liveMonths: liveMonths(d) };
  return cached;
}

export async function stockIndex(): Promise<StockIndex> {
  return (await stockData()).index;
}
