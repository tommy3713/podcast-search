import fs from 'node:fs';
import path from 'node:path';
import { taipeiDayStart } from '@/lib/ask/quota.ts';
import { type DB, defaultDbPath, openDb } from '@/lib/db.ts';
import type { Segment } from '@/lib/segments.ts';
import { isProduction } from '@/lib/env.ts';
import { drain, type EpisodeAction, enqueue, onQueueChange, poll, queueState, runEpisodeAction, seed } from './actions.ts';
import { backfillStep, describePlan, getBackfill, MAX_BACKFILL, planBackfill, runBackfill, startBackfill } from './backfill.ts';
import { backupToR2, episodeCountDrop, verifyBackup } from './backup.ts';
import { runBot } from './bot.ts';
import { notify } from './notify.ts';
import { diskWarning, ping, queueHealthy } from './monitor.ts';
import { getEpisode, getState, setState } from './repo.ts';
import { fetchFeed, parseFeed } from './rss.ts';
import { isLastPollSlot, isNightlySlot, isPollSlot, nextHalfHour, taipeiTime } from './schedule.ts';
import { indexSummaries } from './summary-index.ts';
import { indexSeekTables, startSeekIndex } from './seek-index.ts';
import { askStats, compactDb, digestDue, formatStats, purgeAskLog, rollupAskDaily, unanswered } from './stats.ts';

const USAGE = `usage: worker <command>
  run                 scheduler (poll RSS Wed/Sat 10:00–23:30 Taipei every 30 min, nightly
                      cleanup) plus the Telegram bot for /status, /retry and buttons
  poll                check RSS once and process anything new or retryable
  seed [n]            add the latest n episodes (default 10) and process them
  backfill <n>        add the n newest missing episodes older than the newest one (at most 200)
                      and process them, newest first (local only: in production use Telegram
                      /backfill n, which shares the running worker's queue)
  ingest <ep> [--resummarize | --retranscribe] [--segments-file f]
                      (re)process one episode and reset its retry count. A new or failed
                      episode resumes from the step that failed; a live one is
                      re-summarized. --retranscribe redoes everything.
                      --segments-file uses a JSON transcript ([{start,end,text}] or {segments})
                      instead of downloading and transcribing (dev only)
  nightly             delete ask_log rows older than ASK_LOG_DAYS (30), back up app.db to R2, check
                      the live episode count and free disk space
  status              list episodes and their state
  check-db <file>     integrity check and live episode count of a database (restore drills)
  index-summaries     bring live episodes' summary points up to date (run does this by itself
                      at startup; this is for local snapshots such as the eval's)
  index-seek [ep]     work out where Chromium's seeks land in live episodes lacking it (one
                      download of each episode's audio; run does this by itself)
  migrate             apply pending database migrations and exit (run by the deploy script)`;

async function ingest(db: DB, episodeNo: number, args: string[]): Promise<void> {
  const row = getEpisode(db, episodeNo);
  const live = row?.status === 'done' && !row.failed_step;
  const action: EpisodeAction =
    args.includes('--retranscribe') || !row ? 'retranscribe' : args.includes('--resummarize') || live ? 'resummarize' : 'retry';
  const i = args.indexOf('--segments-file');
  let segments: Segment[] | undefined;
  if (i >= 0) {
    const file = args[i + 1]!;
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    segments = Array.isArray(json) ? json : json.segments;
    if (!segments?.length) throw new Error(`${file} has no segments`);
  }
  await runEpisodeAction(db, action, episodeNo, { segments });
}

async function nightly(db: DB): Promise<void> {
  const dbPath = defaultDbPath();
  const problems: string[] = [];
  const check = (what: string, fn: () => string | null) => {
    try {
      const p = fn();
      if (p) problems.push(p);
    } catch (err) {
      problems.push(`${what}失敗：${err instanceof Error ? err.message : String(err)}`);
    }
  };
  // Before the backup, and each guarded, so a full disk can't stop the report below
  check('磁碟檢查', () => diskWarning(path.dirname(dbPath)));
  check('集數檢查', () => episodeCountDrop(db, `${dbPath}.backup-state.json`));
  // Before the purge below, so the oldest day is still complete
  check('問答彙總', () => {
    rollupAskDaily(db, taipeiTime(new Date()).date);
    return null;
  });
  let purged = 0;
  check('清理問答紀錄', () => {
    purged = purgeAskLog(db);
    console.log(`nightly: deleted ${purged} ask_log rows`);
    return null;
  });
  // Separate from the purge, so a failed VACUUM isn't reported as a failed purge
  check('VACUUM', () => compactDb(db, purged));
  let key: string | null = null;
  try {
    key = await backupToR2(db);
    if (key === null && isProduction()) problems.push('每晚備份被跳過：R2 沒有設定');
  } catch (err) {
    console.error('backup failed', err);
    problems.push(`每晚備份失敗：${err instanceof Error ? err.message : String(err)}`);
  }
  // Healthchecks alerts on a fail ping, or when no ping arrives at all (nightly never ran)
  if (problems.length) {
    const msg = problems.join('\n').slice(0, 600);
    await notify(`❌ ${msg}`);
    await ping(process.env.HC_BACKUP_URL, 'fail', msg);
  } else if (key) {
    await ping(process.env.HC_BACKUP_URL);
  }
}

async function weeklyDigest(db: DB, now: Date): Promise<void> {
  const since = new Date(now.getTime() - 7 * 86_400_000);
  await notify(formatStats('最近 7 天問答', askStats(db, since), unanswered(db, since)));
}

// At the last poll of a release day, say so if nothing published today went live
async function reportReleaseDay(db: DB, now: Date): Promise<void> {
  const { date } = taipeiTime(now);
  const dayStartUtc = taipeiDayStart(date).toISOString();
  const rows = db
    .prepare('SELECT episode_no, status FROM episodes WHERE published_at >= ? ORDER BY episode_no')
    .all(dayStartUtc) as { episode_no: number; status: string }[];
  if (!rows.length) await notify(`ℹ️ ${date} 到 23:30 還沒有新集數`);
  else if (rows.some((r) => r.status !== 'done'))
    await notify(`⚠️ ${date} 有集數還沒上線：${rows.map((r) => `EP${r.episode_no} ${r.status}`).join('、')}`);
}

async function run(db: DB): Promise<void> {
  console.log('worker scheduler started');
  // Deploys restart the worker too, but an unexpected restart (crash, out of memory) shows up here
  await notify('🔄 worker 已啟動');
  // The deploy script waits for an idle queue before replacing this container. Registered
  // before the bot starts, so a command waiting from before a restart is recorded too.
  // Written to a temp file and renamed, so the script never reads half a file.
  const queueFile = `${defaultDbPath()}.queue.json`;
  const writeQueue = () => {
    const { running, runningSince, waiting } = queueState();
    try {
      fs.writeFileSync(`${queueFile}.tmp`, JSON.stringify({ running, since: runningSince && new Date(runningSince).toISOString(), waiting }));
      fs.renameSync(`${queueFile}.tmp`, queueFile);
    } catch (err) {
      console.error('[queue file]', err instanceof Error ? err.message : err);
    }
  };
  // Seek tables of new episodes (and any a restart or failed download left) are worked out
  // whenever the queue goes idle, so right after a publish, outside the queue (seek-index.ts)
  onQueueChange(() => {
    writeQueue();
    const q = queueState();
    if (!q.running && !q.waiting) void startSeekIndex(db);
  });
  writeQueue();
  void runBot(db);
  const heartbeat = () => {
    if (queueHealthy(queueState().runningSince)) void ping(process.env.HC_HEARTBEAT_URL);
  };
  heartbeat();
  setInterval(heartbeat, 30 * 60_000);
  // Pick up anything a crash or restart left half-done, then a backfill a deploy interrupted
  await enqueue('處理未完成的集數', () => drain(db));
  // Summary points of episodes published before summary search, or by the previous release
  // during a deploy. Not awaited: it waits its turn on the queue like any job, and the
  // scheduler below must not wait for it.
  void enqueue('建立摘要索引', () => indexSummaries(db))
    .then(async (r) => {
      if (r.episodes) await notify(`🔎 已為 ${r.episodes} 集建立摘要索引（${r.points} 則）US$${r.costUsd.toFixed(4)}`);
      if (r.failed.length) await notify(`❌ 摘要索引失敗：EP${r.failed.join('、EP')}，下次啟動會再試`.slice(0, 600));
    })
    .catch((err) => console.error('summary index failed', err));
  void startSeekIndex(db);
  void runBackfill(db);
  for (;;) {
    const at = nextHalfHour(new Date());
    await new Promise((r) => setTimeout(r, at.getTime() - Date.now()));
    const t = taipeiTime(at);
    try {
      if (isPollSlot(t)) {
        await enqueue('檢查 RSS', () => poll(db));
        if (isLastPollSlot(t)) await reportReleaseDay(db, at);
      }
      if (isNightlySlot(t)) await enqueue('每晚清理與備份', () => nightly(db));
      const week = digestDue(t, getState(db, 'weekly_digest'));
      if (week) {
        await weeklyDigest(db, at);
        setState(db, 'weekly_digest', week);
      }
    } catch (err) {
      console.error('scheduled task failed', err);
      await notify(`❌ worker 排程錯誤：${err instanceof Error ? err.message : String(err)}`.slice(0, 600));
    }
  }
}

// The CLI's backfill: the same steps as Telegram's, without the pause or a confirmation.
// One left unfinished (an interrupted run) is finished instead, and n is ignored.
async function backfillNow(db: DB, n: number): Promise<void> {
  const left = getBackfill(db);
  if (left) {
    console.log(
      `an unfinished backfill has ${left.episodes.length - left.next} episodes left; finishing those instead of ${n} new ones (run again afterwards)`,
    );
  } else {
    const plan = planBackfill(db, n, parseFeed(await fetchFeed()));
    if (typeof plan === 'string') throw new Error(plan);
    console.log(describePlan(plan));
    startBackfill(db, plan);
  }
  while (await backfillStep(db));
}

function status(db: DB): void {
  const rows = db
    .prepare('SELECT episode_no, title, published_at, status, retries, cost_usd, error FROM episodes ORDER BY episode_no DESC')
    .all() as Record<string, unknown>[];
  console.table(rows.map((r) => ({ ...r, error: r.error ? String(r.error).slice(0, 60) : null })));
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  // Before openDb(), which would migrate (and so change) the file being checked when DB_PATH points at it
  if (cmd === 'check-db') {
    if (!args[0]) throw new Error(USAGE);
    const { episodes } = verifyBackup(args[0]);
    console.log(`${args[0]}: integrity ok, ${episodes} live episodes`);
    return;
  }
  const db = openDb();
  switch (cmd) {
    case 'run':
      return run(db);
    case 'poll': {
      const { found, latestInFeed } = await poll(db);
      if (!found.length) console.log(`nothing new; RSS latest is EP${latestInFeed}`);
      return;
    }
    case 'seed':
      return seed(db, Number(args[0] ?? 10));
    case 'backfill': {
      const n = Number(args[0]);
      if (!Number.isInteger(n) || n < 1 || n > MAX_BACKFILL) throw new Error(`n must be 1–${MAX_BACKFILL}\n${USAGE}`);
      return backfillNow(db, n);
    }
    case 'ingest': {
      const ep = Number(args[0]);
      if (!Number.isInteger(ep)) throw new Error(USAGE);
      return ingest(db, ep, args.slice(1));
    }
    case 'nightly':
      return nightly(db);
    case 'status':
      return status(db);
    case 'index-summaries': {
      const r = await indexSummaries(db);
      if (r.failed.length) process.exitCode = 1;
      else if (!r.episodes) console.log('every live episode is up to date');
      return;
    }
    case 'index-seek': {
      const only = args[0] === undefined ? undefined : Number(args[0]);
      if (only !== undefined && !Number.isInteger(only)) throw new Error(USAGE);
      const r = await indexSeekTables(db, { only });
      if (r.failed.length) process.exitCode = 1;
      else if (!r.episodes) console.log('every live episode has a seek table');
      return;
    }
    case 'migrate':
      // openDb() above already ran any pending migrations; the deploy script calls this
      // with the new image before the web is updated
      console.log(`schema version ${db.pragma('user_version', { simple: true })}`);
      return;
    default:
      console.log(USAGE);
      process.exitCode = cmd ? 1 : 0;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
