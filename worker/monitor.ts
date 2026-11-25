import fs from 'node:fs';
import { taipeiTime } from './schedule.ts';

// Healthchecks.io alerts when an expected ping stops arriving, so it also catches the
// worker, a stuck job or the whole VPS being down, which Telegram messages from the
// worker itself cannot. Without a URL (local dev) this does nothing.
export async function ping(url: string | undefined, outcome: 'success' | 'fail' = 'success', body = ''): Promise<void> {
  if (!url) return;
  try {
    const res = await fetch(outcome === 'fail' ? `${url}/fail` : url, {
      method: 'POST',
      body: body.slice(0, 1000),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error(`[ping] ${res.status} ${res.statusText}`);
  } catch (err) {
    // A failed ping must never fail the worker; Healthchecks alerts on the missing ping
    console.error('[ping]', err instanceof Error ? err.message : err);
  }
}

// A job running longer than this counts as hung. Processing one episode takes about
// 15–20 minutes, so this leaves room for a backlog of several.
export const MAX_JOB_MS = 2 * 3600_000;

// The heartbeat goes out every 30 minutes unless the job queue is stuck, so Healthchecks
// alerts on a dead process, a blocked event loop or a hung job alike (the queue is shared
// by the scheduler and Telegram commands).
export function queueHealthy(runningSince: number | null, now = Date.now(), maxJobMs = MAX_JOB_MS): boolean {
  return runningSince === null || now - runningSince < maxJobMs;
}

// The worker's startup message. A process killed mid-job (out of memory: the nightly backup
// of 2026-11-25) sends nothing itself, so the restart is the first sign of it; it reads the
// queue file the previous process left (written on every queue change, read before this
// process overwrites it). A deploy only replaces an idle worker, so a job still recorded as
// running means the last process ended without finishing it.
export function startupMessage(queueFile: string): string {
  let previous: { running?: unknown; since?: unknown } | null = null;
  try {
    previous = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
  } catch {
    // First start, or an unreadable file: nothing to report
  }
  if (!previous || typeof previous.running !== 'string' || !previous.running) return '🔄 worker 已啟動';
  const since = typeof previous.since === 'string' ? new Date(previous.since) : null;
  const at = since && !Number.isNaN(since.getTime()) ? `（${taipeiTime(since).date} ${clock(since)} 開始）` : '';
  return `⚠️ worker 重新啟動：上一個程序在跑「${previous.running}」${at}時中斷，沒有跑完（記憶體不足、當機或被手動停掉）。docker events 看得到是不是 OOM`;
}

function clock(d: Date): string {
  const { hour, minute } = taipeiTime(d);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// SQLite fails writes outright on a full disk, so warn well before that. Both limits must
// be crossed, so a large disk with plenty of gigabytes left stays quiet.
export function diskWarning(dir: string, minFreeRatio = 0.15, minFreeBytes = 10e9): string | null {
  const s = fs.statfsSync(dir);
  const ratio = s.bavail / s.blocks;
  const bytes = s.bavail * s.bsize;
  if (ratio >= minFreeRatio || bytes >= minFreeBytes) return null;
  return `磁碟只剩 ${(ratio * 100).toFixed(0)}%（${(bytes / 1e9).toFixed(1)} GB）`;
}
