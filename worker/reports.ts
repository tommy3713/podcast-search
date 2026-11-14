import { ASK_LOG_DAYS } from '@/lib/ask/quota.ts';
import type { DB } from '@/lib/db.ts';
import { formatTimestamp } from '@/lib/summary.ts';
import { notify } from './notify.ts';

// Listeners' typo reports (src/lib/reports.ts) are rows the web inserts; the worker tells
// Telegram about new ones and forgets who sent them after ASK_LOG_DAYS.

export const REPORT_POLL_MS = 60_000;
// Listed in one message, at most; the rest go in the next one
const PER_MESSAGE = 10;

type NewRow = { id: number; episode_no: number; target: string; at_sec: number | null; original: string; suggestion: string; note: string | null };

// One message for the reports Telegram hasn't heard about, then marks them. Returns how many.
// The texts are a listener's, so they're cut short; messages are plain text (no parse_mode).
export async function notifyReports(db: DB): Promise<number> {
  const rows = db
    .prepare(
      `SELECT r.id, e.episode_no, r.target, r.at_sec, r.original, r.suggestion, r.note
       FROM typo_reports r JOIN episodes e ON e.id = r.episode_id
       WHERE r.notified_at IS NULL ORDER BY r.id LIMIT ?`,
    )
    .all(PER_MESSAGE) as NewRow[];
  if (!rows.length) return 0;
  const lines = rows.map((r) => {
    const where = r.target === 'transcript' ? `逐字稿${r.at_sec === null ? '' : ` ${formatTimestamp(r.at_sec)}`}` : '重點';
    const note = r.note ? `（${r.note.slice(0, 60)}）` : '';
    return `EP${r.episode_no} ${where}「${r.original}」→「${r.suggestion}」${note}`;
  });
  const link = process.env.SITE_URL ? `\n${process.env.SITE_URL}/admin/reports` : '';
  // Not sent (Telegram down): left unmarked for the next poll
  if ((await notify(`📝 ${rows.length} 則新的錯字回報\n${lines.join('\n')}${link}`)) === false) return 0;
  const mark = db.prepare(`UPDATE typo_reports SET notified_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`);
  db.transaction(() => {
    for (const r of rows) mark.run(r.id);
  })();
  return rows.length;
}

// Every REPORT_POLL_MS. Off the job queue: it only reads reports and sends a message.
export function watchReports(db: DB, intervalMs = REPORT_POLL_MS): () => void {
  let running = false;
  const check = async () => {
    if (running) return;
    running = true;
    try {
      await notifyReports(db);
    } catch (err) {
      console.error('[reports]', err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void check(), intervalMs);
  void check();
  return () => clearInterval(timer);
}

// /about promises a reporter's account id is kept ASK_LOG_DAYS, like a question's. Returns
// how many reports it was taken from (nightly VACUUMs when it's more than none, like the
// question purge, so the ids don't stay readable in free pages).
export function purgeReporters(db: DB): number {
  return db
    .prepare(`UPDATE typo_reports SET user_id = NULL WHERE user_id IS NOT NULL AND created_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?)`)
    .run(`-${ASK_LOG_DAYS} days`).changes;
}
