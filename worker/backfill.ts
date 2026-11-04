import type { DB } from '@/lib/db.ts';
import { addFromFeed, enqueue, queueState } from './actions.ts';
import { estimateCost } from './config.ts';
import { notify } from './notify.ts';
import { processEpisode, STEP_LABEL, usd } from './pipeline.ts';
import { deleteState, episodesIn, episodeStatuses, getEpisode, getState, maxEpisodeNo, setState } from './repo.ts';
import { fetchFeed, parseFeed, type RssEpisode } from './rss.ts';

// RSS polls only add episodes newer than the newest one; older ones are added by a backfill:
// the n newest feed episodes below it that are missing (or backfilled but not live), newest
// first. With the database holding a contiguous run, that is the n episodes below its oldest
// one. Each episode is its own queue job with a pause before the next, so polls and commands
// get in between, and a deploy (which checks every 20 s for an idle queue away from :00/:30,
// for up to an hour) usually finds one. The plan is kept in worker_state, so a restart (a
// deploy) carries on with the episode it was on.
const STATE_KEY = 'backfill';
export const PAUSE_MS = 2 * 60_000;
// Two failures in a row (a used-up Groq quota, an API outage, a broken or unreachable feed)
// stop it instead of paying on
export const STOP_AFTER_FAILURES = 2;
// Per command, so a typo can't start a US$100+ run
export const MAX_BACKFILL = 200;

// `episodes` newest first; `next` is the index of the one to do next; `id` tells one run from
// another; `spent` is what this run paid
export type Backfill = { id: number; episodes: number[]; next: number; failures: number; skipped: number[]; spent: number };

const span = (nos: number[]) => (nos.length === 1 ? `EP${nos[0]}` : `EP${nos[0]}–${nos.at(-1)}`);

export function getBackfill(db: DB): Backfill | null {
  const v = getState(db, STATE_KEY);
  return v ? (JSON.parse(v) as Backfill) : null;
}

const save = (db: DB, b: Backfill) => setState(db, STATE_KEY, JSON.stringify(b));

export type BackfillPlan = { episodes: RssEpisode[]; hours: number; cost: number };

// The n newest feed episodes below the newest one in the database that it lacks, or that an
// earlier backfill added but didn't get live; or why there are none. Other rows that aren't
// live are workQueue's or a command's.
export function planBackfill(db: DB, n: number, feed: RssEpisode[]): BackfillPlan | string {
  const newest = maxEpisodeNo(db);
  if (newest === null) return '資料庫是空的，請先跑 seed';
  const have = episodeStatuses(db);
  const seen = new Set<number>();
  const episodes = feed
    .filter((e) => {
      const row = have.get(e.episodeNo);
      // Two feed items can carry one number (a special titled after an episode)
      if (e.episodeNo >= newest || seen.has(e.episodeNo)) return false;
      seen.add(e.episodeNo);
      return !row || (row.source === 'backfill' && row.status !== 'done');
    })
    .slice(0, n);
  if (!episodes.length) return `EP${newest} 之前的集數都已經補齊了`;
  // Feed durations are close enough for an estimate; 50 minutes when one is missing
  const seconds = episodes.map((e) => e.duration ?? 3000);
  return {
    episodes,
    hours: seconds.reduce((s, d) => s + d, 0) / 3600,
    cost: seconds.reduce((s, d) => s + estimateCost('transcribe', d), 0),
  };
}

export function describePlan(p: BackfillPlan): string {
  const nos = p.episodes.map((e) => e.episodeNo);
  const contiguous = nos[0]! - nos.at(-1)! + 1 === nos.length;
  return `將補 ${span(nos)}${contiguous ? '' : ' 之間缺的'} 共 ${nos.length} 集（${p.hours.toFixed(1)} 小時音檔），預估 ${usd(p.cost)}`;
}

export function startBackfill(db: DB, plan: BackfillPlan): Backfill {
  const b: Backfill = { id: Date.now(), episodes: plan.episodes.map((e) => e.episodeNo), next: 0, failures: 0, skipped: [], spent: 0 };
  save(db, b);
  return b;
}

async function finish(db: DB, b: Backfill, title: string): Promise<false> {
  deleteState(db, STATE_KEY);
  await notify(formatProgress(db, b, title));
  return false;
}

// Processes the next episode of the backfill. False once there is no backfill left:
// finished, stopped after repeated failures, or cancelled with /backfill stop.
export async function backfillStep(db: DB): Promise<boolean> {
  const b = getBackfill(db);
  if (!b) return false;
  const no = b.episodes[b.next];
  if (no === undefined) return finish(db, b, '📚 補集數完成');
  const before = getEpisode(db, no);
  let ok = true;
  let skipped = false;
  // Live meanwhile (a /retranscribe): nothing to do
  if (before?.status !== 'done') {
    // The feed is read for each episode: a run can last days, and audio URLs change
    let feed: RssEpisode[];
    try {
      feed = parseFeed(await fetchFeed());
    } catch (err) {
      return feedFailed(db, b, err);
    }
    const row = addFromFeed(db, feed, no, 'backfill');
    if (row) {
      // A failure is reported by the pipeline as usual
      ok = await processEpisode(db, row, { quiet: true });
    } else {
      ok = false;
      skipped = true;
      await notify(`⚠️ EP${no} 加不進資料庫（RSS 裡找不到，或 guid 和別集重複），跳過`);
    }
  }
  // A lower bound after a restart: what the cut-off attempt saved is already in `before`
  const spent = (getEpisode(db, no)?.cost_usd ?? 0) - (before?.cost_usd ?? 0);
  const now = getBackfill(db);
  // Cancelled, or replaced by a new backfill while this episode ran
  if (now?.id !== b.id) return now !== null;
  const failures = ok ? 0 : now.failures + 1;
  const updated: Backfill = {
    ...now,
    next: now.next + 1,
    failures,
    spent: now.spent + spent,
    skipped: skipped ? [...now.skipped, no] : now.skipped,
  };
  if (failures >= STOP_AFTER_FAILURES) return finish(db, updated, `⏸ 補集數停止：連續 ${failures} 次失敗`);
  if (updated.next >= updated.episodes.length) return finish(db, updated, '📚 補集數完成');
  save(db, updated);
  return true;
}

// An unreadable feed counts as a failure; the same episode is tried again after the pause
async function feedFailed(db: DB, b: Backfill, err: unknown): Promise<boolean> {
  const now = getBackfill(db);
  if (now?.id !== b.id) return now !== null;
  const updated = { ...now, failures: now.failures + 1 };
  const msg = err instanceof Error ? err.message : String(err);
  if (updated.failures >= STOP_AFTER_FAILURES) {
    return finish(db, updated, `⏸ 補集數停止：連續 ${updated.failures} 次失敗（最後一次是讀取 RSS：${msg.slice(0, 200)}）`);
  }
  save(db, updated);
  await notify(`⚠️ 補集數讀取 RSS 失敗：${msg.slice(0, 300)}\n兩分鐘後再試 EP${now.episodes[now.next]}`);
  return true;
}

// Ends the backfill after the episode in progress, if any; returns its progress so far
export function cancelBackfill(db: DB): string | null {
  const b = getBackfill(db);
  if (!b) return null;
  deleteState(db, STATE_KEY);
  const busy = queueState().running?.startsWith('補集數 EP');
  return formatProgress(db, b, busy ? '⏹ 補集數已停止（處理中的那集會做完）' : '⏹ 補集數已停止');
}

export function formatProgress(db: DB, b: Backfill, title: string): string {
  const rows = episodesIn(db, b.episodes.slice(0, b.next));
  const done = rows.filter((r) => r.status === 'done');
  const failed = rows.filter((r) => r.status === 'failed');
  const left = b.episodes.length - b.next;
  const lines = [
    `${title}：${span(b.episodes)}`,
    `上線 ${done.length} 集・失敗 ${failed.length} 集${b.skipped.length ? `・跳過 ${b.skipped.length} 集` : ''}${left > 0 ? `・還沒補 ${left} 集` : ''}・這次花了 ${usd(b.spent)}`,
  ];
  if (failed.length) {
    const list = failed.slice(0, 10).map((r) => `EP${r.episode_no}「${r.failed_step ? STEP_LABEL[r.failed_step] : '?'}」`);
    lines.push(`失敗：${list.join('、')}${failed.length > 10 ? ' 等' : ''}（下次 /backfill 會重試，也可以 /retry）`);
  }
  if (b.skipped.length) lines.push(`跳過：${b.skipped.map((n) => `EP${n}`).join('、')}`);
  return lines.join('\n');
}

export function backfillStatus(db: DB): string {
  const b = getBackfill(db);
  if (b) return formatProgress(db, b, '📚 補集數中');
  return '目前沒有在補集數。例如 /backfill 20 會補缺少的集數中最新的 20 集（包括之前補失敗的）';
}

let running = false;

// Runs the backfill in the database, if any, until it is over; does nothing if already running.
// Called when a backfill is confirmed, by /backfill (resuming one an error interrupted) and
// when the worker starts.
export function runBackfill(db: DB, pauseMs = PAUSE_MS): Promise<void> {
  if (running || !getBackfill(db)) return Promise.resolve();
  running = true;
  return (async () => {
    try {
      for (;;) {
        const b = getBackfill(db);
        const no = b?.episodes[b.next];
        // An episode live already is passed over at once; only real work earns the pause
        const live = no !== undefined && getEpisode(db, no)?.status === 'done';
        if (!b || !(await enqueue(no === undefined ? '補集數收尾' : `補集數 EP${no}`, () => backfillStep(db)))) break;
        if (!live) await new Promise((r) => setTimeout(r, pauseMs));
      }
    } catch (err) {
      // Kept in worker_state: the next start picks it up again
      console.error('[backfill]', err);
      await notify(`❌ 補集數中斷：${err instanceof Error ? err.message : String(err)}`.slice(0, 500) + '\n/backfill 或重啟 worker 會接著補');
    } finally {
      running = false;
    }
  })();
}
