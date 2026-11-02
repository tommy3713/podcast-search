import fs from 'node:fs';

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

// SQLite fails writes outright on a full disk, so warn well before that. Both limits must
// be crossed, so a large disk with plenty of gigabytes left stays quiet.
export function diskWarning(dir: string, minFreeRatio = 0.15, minFreeBytes = 10e9): string | null {
  const s = fs.statfsSync(dir);
  const ratio = s.bavail / s.blocks;
  const bytes = s.bavail * s.bsize;
  if (ratio >= minFreeRatio || bytes >= minFreeBytes) return null;
  return `磁碟只剩 ${(ratio * 100).toFixed(0)}%（${(bytes / 1e9).toFixed(1)} GB）`;
}
