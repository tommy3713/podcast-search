import type { DB } from './db.ts';
import { monthKey } from './format.ts';
import { readDb } from './server-db.ts';
import { buildStockIndex, type StockIndex, type StockRow } from './stocks.ts';
import { STOCK_CATEGORY } from './summary.ts';

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
  if (cached?.version !== version) cached = { version, index: buildStockIndex(stockRows(d)), liveMonths: liveMonths(d) };
  return cached;
}

export async function stockIndex(): Promise<StockIndex> {
  return (await stockData()).index;
}
