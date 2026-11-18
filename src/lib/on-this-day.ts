import type { DB } from './db.ts';
import { TAIPEI_OFFSET_MS } from './format.ts';

// 歷史上的今天 on the home page: for each earlier year, the live episode released nearest to
// today's month and day (Taipei), within ON_THIS_DAY_WINDOW days, with what it was about at a
// glance: its line, first key points (timestamps link into it) and stocks. Newest year first.
// Two episodes a week (Wednesday and Saturday), so a year has one within 3 days unless the
// show was off or that stretch isn't backfilled, and then the year is left out. Two years'
// days are 365 or more apart, so no episode is near both.
export const ON_THIS_DAY_WINDOW = 7;
export const ON_THIS_DAY_KEYS = 3;
export const ON_THIS_DAY_STOCKS = 4;
// The years shown: the newest ones with an episode near the day. globals.css has a rule per
// year's panel (.otd-panel:nth-of-type): more years need more rules.
export const ON_THIS_DAY_YEARS = 3;

export type OnThisDay = {
  yearsAgo: number;
  // The year it stands for, not always the episode's own: near New Year the nearest one can be
  // in the calendar year after or before
  year: number;
  no: number;
  title: string;
  publishedAt: string;
  line: string;
  keys: { t: number; text: string }[];
  stocks: string[];
};

const DAY_MS = 86_400_000;
// A Taipei date (YYYY-MM-DD) as a day count, and an instant's Taipei date as one (NaN when it
// doesn't parse)
const dayOf = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
const taipeiDay = (iso: string) => Math.floor((Date.parse(iso) + TAIPEI_OFFSET_MS) / DAY_MS);

// Today's month and day in another year; 2/29 is 2/28 in a year without it
function sameDay(today: string, year: number): number {
  const [, m, d] = today.split('-');
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return dayOf(`${year}-${m}-${m === '02' && d === '29' && !leap ? '28' : d}`);
}

// The picks change only with the day and the live episodes: kept until either moves, so the
// home page, the most loaded route, reads one row per request
const cache = new WeakMap<DB, { key: string; items: OnThisDay[] }>();

// `today`: the Taipei date, YYYY-MM-DD
export function onThisDay(db: DB, today: string): OnThisDay[] {
  const v = db.prepare(`SELECT COUNT(*) AS n, MAX(updated_at) AS at FROM episodes WHERE status = 'done'`).get() as { n: number; at: string | null };
  const key = `${today} ${v.n} ${v.at}`;
  let hit = cache.get(db);
  if (hit?.key !== key) cache.set(db, (hit = { key, items: pick(db, today) }));
  return hit.items;
}

function pick(db: DB, today: string): OnThisDay[] {
  // An episode whose date doesn't parse is left out, not the section
  const rows = (db.prepare(`SELECT id, published_at AS publishedAt FROM episodes WHERE status = 'done'`).all() as { id: number; publishedAt: string }[])
    .map((r) => ({ id: r.id, day: taipeiDay(r.publishedAt) }))
    .filter((r) => Number.isFinite(r.day));
  if (!rows.length) return [];
  const thisYear = Number(today.slice(0, 4));
  const oldest = new Date(Math.min(...rows.map((r) => r.day)) * DAY_MS).getUTCFullYear();
  const picked: { id: number; yearsAgo: number }[] = [];
  // Down to the year before the oldest episode: near New Year a target's window reaches into
  // the previous calendar year
  for (let year = thisYear - 1; year >= oldest - 1 && picked.length < ON_THIS_DAY_YEARS; year--) {
    const target = sameDay(today, year);
    let best: { id: number; off: number; day: number } | undefined;
    for (const r of rows) {
      const off = Math.abs(r.day - target);
      // Nearest, and of two as near, the later one
      if (off <= ON_THIS_DAY_WINDOW && (!best || off < best.off || (off === best.off && r.day > best.day))) best = { id: r.id, off, day: r.day };
    }
    if (best) picked.push({ id: best.id, yearsAgo: thisYear - year });
  }
  if (!picked.length) return [];
  // The line and stock names as episodes.ts reads them, the key points parsed here; a summary
  // that doesn't parse, or keys or stocks not shaped as the summary writes them, shows the
  // episode without them rather than failing the home page
  const found = db
    .prepare(
      `SELECT id, episode_no, title, published_at,
         CASE WHEN json_valid(summary_json) THEN json_extract(summary_json, '$.line') END AS line,
         CASE WHEN json_valid(summary_json) AND json_type(summary_json, '$.keys') = 'array' THEN json_extract(summary_json, '$.keys') END AS keys,
         CASE WHEN json_valid(summary_json) AND json_type(summary_json, '$.stocks') = 'array'
           THEN (SELECT json_group_array(CASE WHEN s.type = 'object' THEN json_extract(s.value, '$.name') END) FROM json_each(summary_json, '$.stocks') s) END AS stocks
       FROM episodes WHERE id IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify(picked.map((p) => p.id))) as { id: number; episode_no: number; title: string; published_at: string; line: unknown; keys: string | null; stocks: string | null }[];
  const details = new Map(found.map((r) => [r.id, r]));
  return picked.flatMap(({ id, yearsAgo }) => {
    const r = details.get(id);
    if (!r) return [];
    const keys = (r.keys ? (JSON.parse(r.keys) as unknown[]) : [])
      .filter((k): k is { t: number; text: string } => typeof (k as { t?: unknown })?.t === 'number' && typeof (k as { text?: unknown })?.text === 'string')
      .slice(0, ON_THIS_DAY_KEYS)
      .map((k) => ({ t: Math.floor(k.t), text: k.text }));
    const stocks = [...new Set((r.stocks ? (JSON.parse(r.stocks) as unknown[]) : []).filter((n): n is string => typeof n === 'string' && n !== ''))].slice(0, ON_THIS_DAY_STOCKS);
    return [{ yearsAgo, year: Number(today.slice(0, 4)) - yearsAgo, no: r.episode_no, title: r.title, publishedAt: r.published_at, line: typeof r.line === 'string' ? r.line : '', keys, stocks }];
  });
}
