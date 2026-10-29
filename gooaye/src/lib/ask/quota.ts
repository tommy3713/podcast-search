import type { DB } from '../db.ts';

export const USER_DAILY_LIMIT = 20;
export const SITE_DAILY_LIMIT = 500;

// Days reset at 00:00 Taipei (UTC+8, no DST)
export function taipeiDate(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

export function remaining(db: DB, userId: string, now = new Date()): number {
  const row = db.prepare('SELECT count FROM ask_usage WHERE user_id = ? AND date = ?').get(userId, taipeiDate(now)) as
    | { count: number }
    | undefined;
  return Math.max(0, USER_DAILY_LIMIT - (row?.count ?? 0));
}

export type QuotaResult = { ok: true; remaining: number } | { ok: false; reason: 'user' | 'site' };

// Charged before calling any model, so a burst of requests can't overspend
export function takeQuota(db: DB, userId: string, now = new Date()): QuotaResult {
  const date = taipeiDate(now);
  return db.transaction((): QuotaResult => {
    const site = (db.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM ask_usage WHERE date = ?').get(date) as { n: number }).n;
    if (site >= SITE_DAILY_LIMIT) return { ok: false, reason: 'site' };
    const used = (db.prepare('SELECT count FROM ask_usage WHERE user_id = ? AND date = ?').get(userId, date) as { count: number } | undefined)?.count ?? 0;
    if (used >= USER_DAILY_LIMIT) return { ok: false, reason: 'user' };
    db.prepare(
      `INSERT INTO ask_usage (user_id, date, count) VALUES (?, ?, 1)
       ON CONFLICT (user_id, date) DO UPDATE SET count = count + 1`,
    ).run(userId, date);
    return { ok: true, remaining: USER_DAILY_LIMIT - used - 1 };
  }).immediate();
}

// Given back when the answer failed for reasons that aren't the user's
export function refundQuota(db: DB, userId: string, now = new Date()): void {
  db.prepare('UPDATE ask_usage SET count = MAX(0, count - 1) WHERE user_id = ? AND date = ?').run(userId, taipeiDate(now));
}

export function logAsk(db: DB, userId: string, question: string, toolCalls: unknown[]): void {
  db.prepare('INSERT INTO ask_log (user_id, question, tool_calls_json) VALUES (?, ?, ?)').run(
    userId,
    question,
    JSON.stringify(toolCalls),
  );
}
