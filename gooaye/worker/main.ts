import fs from 'node:fs';
import { type DB, openDb } from '@/lib/db.ts';
import type { Segment } from '@/lib/segments.ts';
import { drain, type EpisodeAction, enqueue, poll, runEpisodeAction, seed } from './actions.ts';
import { runBot } from './bot.ts';
import { notify } from './notify.ts';
import { getEpisode } from './repo.ts';
import { isLastPollSlot, isNightlySlot, isPollSlot, nextHalfHour, taipeiTime } from './schedule.ts';

const USAGE = `usage: worker <command>
  run                 scheduler (poll RSS Wed/Sat 10:00–23:30 Taipei every 30 min, nightly
                      cleanup) plus the Telegram bot for /status, /retry and buttons
  poll                check RSS once and process anything new or retryable
  seed [n]            add the latest n episodes (default 10) and process them
  ingest <ep> [--resummarize | --retranscribe] [--segments-file f]
                      (re)process one episode and reset its retry count. A new or failed
                      episode resumes from the step that failed; a live one is
                      re-summarized. --retranscribe redoes everything.
                      --segments-file uses a JSON transcript ([{start,end,text}] or {segments})
                      instead of downloading and transcribing (dev only)
  nightly             delete ask_log rows older than 30 days
  status              list episodes and their state`;

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

function nightly(db: DB): void {
  const r = db.prepare(`DELETE FROM ask_log WHERE created_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-30 days')`).run();
  db.prepare(`DELETE FROM ask_usage WHERE date < date('now', '-7 days')`).run();
  console.log(`nightly: deleted ${r.changes} ask_log rows`);
}

// At the last poll of a release day, say so if nothing published today went live
async function reportReleaseDay(db: DB, now: Date): Promise<void> {
  const { date } = taipeiTime(now);
  const dayStartUtc = new Date(`${date}T00:00:00+08:00`).toISOString();
  const rows = db
    .prepare('SELECT episode_no, status FROM episodes WHERE published_at >= ? ORDER BY episode_no')
    .all(dayStartUtc) as { episode_no: number; status: string }[];
  if (!rows.length) await notify(`ℹ️ ${date} 到 23:30 還沒有新集數`);
  else if (rows.some((r) => r.status !== 'done'))
    await notify(`⚠️ ${date} 有集數還沒上線：${rows.map((r) => `EP${r.episode_no} ${r.status}`).join('、')}`);
}

async function run(db: DB): Promise<void> {
  console.log('worker scheduler started');
  void runBot(db);
  // Pick up anything a crash or restart left half-done
  await enqueue('處理未完成的集數', () => drain(db));
  for (;;) {
    const at = nextHalfHour(new Date());
    await new Promise((r) => setTimeout(r, at.getTime() - Date.now()));
    const t = taipeiTime(at);
    try {
      if (isPollSlot(t)) {
        await enqueue('檢查 RSS', () => poll(db));
        if (isLastPollSlot(t)) await reportReleaseDay(db, at);
      }
      if (isNightlySlot(t)) nightly(db);
    } catch (err) {
      console.error('scheduled task failed', err);
      await notify(`❌ worker 排程錯誤：${err instanceof Error ? err.message : String(err)}`.slice(0, 600));
    }
  }
}

function status(db: DB): void {
  const rows = db
    .prepare('SELECT episode_no, title, published_at, status, retries, cost_usd, error FROM episodes ORDER BY episode_no DESC')
    .all() as Record<string, unknown>[];
  console.table(rows.map((r) => ({ ...r, error: r.error ? String(r.error).slice(0, 60) : null })));
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
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
    case 'ingest': {
      const ep = Number(args[0]);
      if (!Number.isInteger(ep)) throw new Error(USAGE);
      return ingest(db, ep, args.slice(1));
    }
    case 'nightly':
      return nightly(db);
    case 'status':
      return status(db);
    default:
      console.log(USAGE);
      process.exitCode = cmd ? 1 : 0;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
