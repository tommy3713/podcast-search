import type { DB } from './db.ts';
import { appendSegment, monthKey } from './format.ts';
import { parseSeekTable, type PlayPoint, playPoint, type SeekTable } from './seek.ts';
import type { Segment } from './segments.ts';
import { readDb } from './server-db.ts';
import { type AdChapter, buildSponsorIndex, type SponsorIndex } from './sponsors.ts';
import { buildTopicIndex, TOPIC_CATEGORIES, type TopicIndex, type TopicRow } from './topics.ts';
import { buildStockIndex, type EpisodeOutline, type StockIndex, type StockNote, type StockRow } from './stocks.ts';
import { STOCK_CATEGORY, type Summary } from './summary.ts';

// Live episodes' stock rows, newest episode first
export function stockRows(db: DB): StockRow[] {
  return db
    .prepare(
      `SELECT m.name, m.code, m.detail, m.start_sec AS startSec, e.episode_no AS episodeNo, e.title, e.published_at AS publishedAt,
         e.audio_url AS audioUrl
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

export type Excerpt = { t: number; text: string; point: PlayPoint | null };

// With where to start the audio for it, so 從這裡開始聽 plays on the page
export function excerptAt(db: DB, episodeNo: number, t: number): Excerpt | null {
  const row = db.prepare(`SELECT segments_json FROM episodes WHERE episode_no = ? AND status = 'done'`).get(episodeNo) as
    | { segments_json: string | null }
    | undefined;
  const excerpt = row?.segments_json ? excerptFrom(JSON.parse(row.segments_json) as Segment[], t) : null;
  return excerpt && { ...excerpt, point: playPoint(seekTablesOf(db, [episodeNo]).get(episodeNo) ?? null, excerpt.t) };
}

// Parsed seek tables (about 5.5 KB of JSON each), kept until the index is rebuilt: a stock's
// page needs one per episode on it. Only tables are kept: an episode without one is asked
// about again, since the worker fills seek_json in later without touching updated_at.
const seekTables = new Map<number, SeekTable>();

// The web never migrates, so a snapshot from before seek_json still has to open
const seekColumn = new WeakMap<DB, boolean>();
function hasSeekColumn(db: DB): boolean {
  let has = seekColumn.get(db);
  if (has === undefined) {
    has = (db.prepare('PRAGMA table_info(episodes)').all() as { name: string }[]).some((c) => c.name === 'seek_json');
    seekColumn.set(db, has);
  }
  return has;
}

// null: nothing to correct, or not worked out yet
function seekTablesOf(db: DB, episodeNos: number[]): Map<number, SeekTable | null> {
  const tables = new Map<number, SeekTable | null>();
  const read = hasSeekColumn(db) ? db.prepare(`SELECT seek_json FROM episodes WHERE episode_no = ? AND status = 'done'`) : null;
  for (const no of episodeNos) {
    let table = seekTables.get(no) ?? null;
    if (!table && read) {
      table = parseSeekTable((read.get(no) as { seek_json: string | null } | undefined)?.seek_json ?? null);
      if (table) seekTables.set(no, table);
    }
    tables.set(no, table);
  }
  return tables;
}

// Where to start the audio for every timestamp on a stock's page: "<episode>:<seconds>" →
// PlayPoint, or null to play from the time as it is
export function stockPlayPoints(db: DB, stock: { episodes: { no: number; notes: StockNote[]; points?: StockNote[] }[] }): Map<string, PlayPoint | null> {
  const points = new Map<string, PlayPoint | null>();
  const tables = seekTablesOf(db, stock.episodes.map((e) => e.no));
  for (const e of stock.episodes) {
    const table = tables.get(e.no) ?? null;
    for (const n of [...e.notes, ...(e.points ?? [])]) points.set(`${e.no}:${n.t}`, playPoint(table, n.t));
  }
  return points;
}

// Live episodes' ad chapters, for the sponsor pages. A chapter whose JSON is off is left out.
export function adChapters(db: DB): AdChapter[] {
  const rows = db
    .prepare(
      `SELECT e.episode_no AS episodeNo, e.title, e.published_at AS publishedAt, e.audio_url AS audioUrl,
         json_extract(c.value, '$.title') AS chapterTitle, json_extract(c.value, '$.t') AS t, json_extract(c.value, '$.bullets') AS bullets
       FROM episodes e, json_each(e.summary_json, '$.chapters') c
       WHERE e.status = 'done' AND json_valid(e.summary_json) AND json_extract(c.value, '$.ad') = 1`,
    )
    .all() as { episodeNo: number; title: string; publishedAt: string; audioUrl: string; chapterTitle: string | null; t: number | null; bullets: string | null }[];
  const chapters: AdChapter[] = [];
  for (const r of rows) {
    // Every page reads the index this feeds, so a chapter that isn't the expected shape is
    // left out rather than taking the site down
    try {
      const raw: unknown = r.bullets ? JSON.parse(r.bullets) : [];
      if (!Array.isArray(raw) || typeof r.chapterTitle !== 'string' || typeof r.t !== 'number') continue;
      const bullets = raw.filter((b): b is { t: number; text: string } => typeof b?.text === 'string' && typeof b?.t === 'number');
      chapters.push({ episodeNo: r.episodeNo, episodeTitle: r.title, publishedAt: r.publishedAt, audioUrl: r.audioUrl, title: r.chapterTitle, t: r.t, bullets });
    } catch {
      // Left out
    }
  }
  return chapters;
}

// Live episodes' mentions in the topic categories
export function topicRows(db: DB): TopicRow[] {
  const cats = TOPIC_CATEGORIES.map((c) => c.category);
  return db
    .prepare(
      `SELECT m.category, m.name, m.quote, m.start_sec AS startSec, e.episode_no AS episodeNo, e.title, e.published_at AS publishedAt,
         e.audio_url AS audioUrl
       FROM mentions m JOIN episodes e ON e.id = m.episode_id
       WHERE e.status = 'done' AND m.category IN (${cats.map(() => '?').join(', ')})
       ORDER BY e.episode_no DESC, m.start_sec, m.id`,
    )
    .all(...cats) as TopicRow[];
}

// Every episode page needs the index for its links, so it is built once and kept until an
// episode is published, re-run or taken down: each of those moves the count of live episodes
// or their newest updated_at. Not PRAGMA data_version, which every logged question moves too.
// newest: the numbers of the newest live episodes, newest first, for the 最近提到 strips
type Pages = { index: StockIndex; sponsors: SponsorIndex; topics: TopicIndex; liveMonths: Map<string, number>; newest: number[] };
let cached: ({ version: string } & Pages) | undefined;

// The newest live episodes' numbers, newest first
export function newestEpisodes(db: DB, n: number): number[] {
  return (db.prepare(`SELECT episode_no FROM episodes WHERE status = 'done' ORDER BY published_at DESC, episode_no DESC LIMIT ?`).all(n) as { episode_no: number }[]).map((r) => r.episode_no);
}

// Live episodes per month (Taipei), for the chart on a stock's page
export function liveMonths(db: DB): Map<string, number> {
  const months = new Map<string, number>();
  const rows = db.prepare(`SELECT published_at FROM episodes WHERE status = 'done'`).all() as { published_at: string }[];
  for (const r of rows) months.set(monthKey(r.published_at), (months.get(monthKey(r.published_at)) ?? 0) + 1);
  return months;
}

// The index and the months of one moment: read apart, a publish in between could leave a
// stock with an episode in a month the chart doesn't have
export async function stockData(): Promise<Pages> {
  const d = await readDb();
  const v = d.prepare(`SELECT COUNT(*) AS n, MAX(updated_at) AS at FROM episodes WHERE status = 'done'`).get() as { n: number; at: string | null };
  const version = `${v.n} ${v.at}`;
  if (cached?.version !== version) {
    seekTables.clear();
    cached = {
      version,
      index: buildStockIndex(stockRows(d), episodeOutlines(d)), sponsors: buildSponsorIndex(adChapters(d)),
      topics: buildTopicIndex(topicRows(d)),
      liveMonths: liveMonths(d),
      newest: newestEpisodes(d, 2),
    };
  }
  return cached;
}

export async function stockIndex(): Promise<StockIndex> {
  return (await stockData()).index;
}
