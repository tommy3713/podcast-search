import type { DB } from '@/lib/db.ts';
import type { Segment } from '@/lib/segments.ts';
import { processEpisode } from './pipeline.ts';
import {
  type EpisodeRow,
  getEpisode,
  insertDiscovered,
  maxEpisodeNo,
  resetRetries,
  type Source,
  setAudioUrl,
  workQueue,
} from './repo.ts';
import { fetchFeed, parseFeed, type RssEpisode } from './rss.ts';

// One job at a time: the scheduler and Telegram commands share this queue, so two
// runs never touch the same episode (or the Groq quota) at once.
let tail: Promise<unknown> = Promise.resolve();
let running: string | null = null;
let runningSince: number | null = null;
let waiting = 0;
let onChange: (() => void) | null = null;

// Called whenever a job starts or ends (the deploy script reads the queue state from a file)
export function onQueueChange(fn: (() => void) | null): void {
  onChange = fn;
}

export function enqueue<T>(label: string, job: () => Promise<T>): Promise<T> {
  waiting++;
  onChange?.();
  const next = tail.then(async () => {
    waiting--;
    running = label;
    runningSince = Date.now();
    onChange?.();
    try {
      return await job();
    } finally {
      running = null;
      runningSince = null;
      onChange?.();
    }
  });
  tail = next.catch(() => {});
  return next;
}

export function queueState(): { running: string | null; runningSince: number | null; waiting: number } {
  return { running, runningSince, waiting };
}

export async function poll(db: DB): Promise<{ found: RssEpisode[]; latestInFeed: number | null }> {
  const feed = parseFeed(await fetchFeed());
  const latest = maxEpisodeNo(db);
  if (latest === null) throw new Error('database is empty; run `worker seed` first');
  // Only episodes newer than what we have; older ones come in through a backfill (backfill.ts)
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

// Adds the feed's episode when the database lacks it; a row that isn't live yet takes the feed's
// current audio URL. Undefined when it can't be added: not in the feed, or its guid belongs to
// another episode.
export function addFromFeed(db: DB, feed: RssEpisode[], episodeNo: number, source: Source = 'rss'): EpisodeRow | undefined {
  const item = feed.find((e) => e.episodeNo === episodeNo);
  const row = getEpisode(db, episodeNo);
  if (!row) {
    if (item) insertDiscovered(db, item, source);
  } else if (item && row.status !== 'done' && item.audioUrl !== row.audio_url) {
    setAudioUrl(db, row.id, item.audioUrl);
  }
  return getEpisode(db, episodeNo);
}

async function ensureEpisode(db: DB, episodeNo: number): Promise<EpisodeRow> {
  const row = getEpisode(db, episodeNo) ?? addFromFeed(db, parseFeed(await fetchFeed()), episodeNo);
  if (!row) throw new Error(`EP${episodeNo} 不在 RSS 裡`);
  return row;
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
