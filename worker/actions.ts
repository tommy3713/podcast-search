import type { DB } from '@/lib/db.ts';
import type { Segment } from '@/lib/segments.ts';
import { processEpisode } from './pipeline.ts';
import { type EpisodeRow, getEpisode, insertDiscovered, maxEpisodeNo, resetRetries, workQueue } from './repo.ts';
import { fetchFeed, parseFeed, type RssEpisode } from './rss.ts';

// One job at a time: the scheduler and Telegram commands share this queue, so two
// runs never touch the same episode (or the Groq quota) at once.
let tail: Promise<unknown> = Promise.resolve();
let running: string | null = null;
let waiting = 0;

export function enqueue<T>(label: string, job: () => Promise<T>): Promise<T> {
  waiting++;
  const next = tail.then(async () => {
    waiting--;
    running = label;
    try {
      return await job();
    } finally {
      running = null;
    }
  });
  tail = next.catch(() => {});
  return next;
}

export function queueState(): { running: string | null; waiting: number } {
  return { running, waiting };
}

export async function poll(db: DB): Promise<{ found: RssEpisode[]; latestInFeed: number | null }> {
  const feed = parseFeed(await fetchFeed());
  const latest = maxEpisodeNo(db);
  if (latest === null) throw new Error('database is empty; run `worker seed` first');
  // Only episodes newer than what we have; old episodes are never backfilled
  const found = feed.filter((e) => e.episodeNo > latest && insertDiscovered(db, e));
  for (const ep of found) console.log(`found EP${ep.episodeNo} ${ep.title}`);
  await drain(db);
  return { found, latestInFeed: feed[0]?.episodeNo ?? null };
}

export async function drain(db: DB): Promise<void> {
  for (const ep of workQueue(db)) await processEpisode(db, ep);
}

export async function seed(db: DB, n: number): Promise<void> {
  const feed = parseFeed(await fetchFeed()).slice(0, n);
  for (const ep of feed) insertDiscovered(db, ep);
  console.log(`seeded EP${feed.at(-1)?.episodeNo}–EP${feed[0]?.episodeNo}`);
  await drain(db);
}

export type EpisodeAction = 'retry' | 'resummarize' | 'retranscribe';

export const ACTION_LABEL: Record<EpisodeAction, string> = {
  retry: '從失敗的步驟重試',
  resummarize: '重新整理重點',
  retranscribe: '重新轉錄',
};

async function ensureEpisode(db: DB, episodeNo: number): Promise<EpisodeRow> {
  if (!getEpisode(db, episodeNo)) {
    const ep = parseFeed(await fetchFeed()).find((e) => e.episodeNo === episodeNo);
    if (!ep) throw new Error(`EP${episodeNo} 不在 RSS 裡`);
    insertDiscovered(db, ep);
  }
  return getEpisode(db, episodeNo)!;
}

// Checks an action can run; returns a reason it can't, or null
export function checkAction(db: DB, action: EpisodeAction, episodeNo: number): string | null {
  const row = getEpisode(db, episodeNo);
  if (action === 'retranscribe') return null; // works for episodes not added yet too
  if (!row) return `EP${episodeNo} 還沒收錄`;
  if (action === 'retry' && row.status === 'done' && !row.failed_step) return `EP${episodeNo} 已經上線，沒有失敗的步驟`;
  if (action === 'resummarize' && !row.segments_json) return `EP${episodeNo} 還沒有逐字稿，請用重新轉錄`;
  return null;
}

// Manual runs reset the retry count, so the scheduler may try again afterwards
export async function runEpisodeAction(
  db: DB,
  action: EpisodeAction,
  episodeNo: number,
  opts: { segments?: Segment[] } = {},
): Promise<boolean> {
  const reason = checkAction(db, action, episodeNo);
  if (reason) throw new Error(reason);
  const row = await ensureEpisode(db, episodeNo);
  resetRetries(db, row.id);
  const redoFrom = action === 'retranscribe' ? 'transcribe' : action === 'resummarize' ? 'summarize' : undefined;
  return processEpisode(db, { ...row, retries: 0 }, { redoFrom, segments: opts.segments });
}
