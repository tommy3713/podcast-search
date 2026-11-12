import type { DB } from '@/lib/db.ts';
import type { Summary } from '@/lib/summary.ts';
import { type SummaryPoint, summaryPoints } from './chunk.ts';
import { embed } from './embed.ts';
import { indexSummaryPoints, liveSummaryPoints } from './repo.ts';

export type StalePoints = { id: number; episodeNo: number; points: SummaryPoint[] };

// Live episodes whose stored summary points aren't the ones their summary gives: none yet
// (published before summary search, or by the previous release during a deploy), left from
// an earlier summary (a release from before summary search re-ran the episode), or made by
// an older summaryPoints. `broken`: episodes whose summary can't be read.
export function staleSummaryPoints(db: DB): { stale: StalePoints[]; broken: number[] } {
  const stale: StalePoints[] = [];
  const broken: number[] = [];
  for (const row of liveSummaryPoints(db)) {
    let points: SummaryPoint[];
    try {
      points = summaryPoints(JSON.parse(row.summary_json) as Summary);
    } catch (err) {
      console.error(`EP${row.episode_no}: unreadable summary`, err);
      broken.push(row.episode_no);
      continue;
    }
    if (JSON.stringify(points) !== JSON.stringify(row.points)) stale.push({ id: row.id, episodeNo: row.episode_no, points });
  }
  return { stale, broken };
}

const BATCH_TEXTS = 100; // what one embeddings request takes (embed.ts)

// Brings every live episode's summary points up to date. Runs on the queue, so no publish
// happens in between. Several episodes go in one embeddings request; a request that fails
// leaves its episodes for the next run, and the rest carry on.
export async function indexSummaries(db: DB): Promise<{ episodes: number; points: number; failed: number[]; costUsd: number }> {
  const { stale, broken } = staleSummaryPoints(db);
  const failed = [...broken];
  let episodes = 0;
  let points = 0;
  let costUsd = 0;
  const run = async (batch: StalePoints[]) => {
    const texts = batch.flatMap((e) => e.points.map((p) => p.text));
    try {
      const res = texts.length ? await embed(texts) : { vectors: [], costUsd: 0 };
      let at = 0;
      for (const e of batch) {
        const n = e.points.length;
        // Each episode is charged its share of the request, by text count
        indexSummaryPoints(db, e.id, e.points, res.vectors.slice(at, at + n), texts.length ? (res.costUsd * n) / texts.length : 0);
        at += n;
        episodes++;
        points += n;
      }
      costUsd += res.costUsd;
    } catch (err) {
      console.error(`summary index: ${batch.map((e) => `EP${e.episodeNo}`).join(' ')} failed`, err);
      failed.push(...batch.map((e) => e.episodeNo));
    }
  };
  let batch: StalePoints[] = [];
  let size = 0;
  for (const e of stale) {
    if (batch.length && size + e.points.length > BATCH_TEXTS) {
      await run(batch);
      batch = [];
      size = 0;
    }
    batch.push(e);
    size += e.points.length;
  }
  if (batch.length) await run(batch);
  if (episodes || failed.length) {
    console.log(`summary index: ${points} points in ${episodes} episodes, US$${costUsd.toFixed(4)}${failed.length ? `; failed EP${failed.join(', EP')}` : ''}`);
  }
  return { episodes, points, failed, costUsd };
}
