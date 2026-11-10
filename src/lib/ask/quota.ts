import { type DB, toDbTime } from '../db.ts';
import type { ToolCallLog } from './agent.ts';

export const USER_DAILY_LIMIT = 20;
export const SITE_DAILY_LIMIT = 500;
// Nightly deletes ask_log rows older than this (and backups carry none); /about and /ask
// tell users so, so change all of them together by changing this
export const ASK_LOG_DAYS = 30;

// Days reset at 00:00 Taipei (UTC+8, no DST)
export function taipeiDate(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

// When a Taipei day (YYYY-MM-DD) starts, plusDays later. Format it for the column it is
// compared with: toDbTime for created_at, toISOString for published_at (which keeps ms).
export function taipeiDayStart(day: string, plusDays = 0): Date {
  return new Date(Date.parse(`${day}T00:00:00+08:00`) + plusDays * 86_400_000);
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

// answered: cites at least one source. no_source: answered without citing anything,
// which is how "can't answer that from the show" shows up (or the model ignoring the
// rules). The rest never produced a full answer.
export type AskOutcome = 'answered' | 'no_source' | 'moderated' | 'quota' | 'timeout' | 'aborted' | 'error';

export type AskLogEntry = {
  userId: string;
  question: string;
  outcome: AskOutcome;
  answer?: string;
  cited?: number;
  ms?: number;
  toolCalls?: ToolCallLog[];
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
};

// Never throws: a logging failure must not fail the answer (and the web may write here
// moments before the worker's migration adds the columns)
export function logAsk(db: DB, e: AskLogEntry): void {
  try {
    const calls = e.toolCalls ?? [];
    db.prepare(
      `INSERT INTO ask_log (user_id, question, tool_calls_json, outcome, answer, cited, hits, ms, input_tokens, output_tokens, cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      e.userId,
      e.question,
      JSON.stringify(calls),
      e.outcome,
      e.answer || null,
      e.cited ?? null,
      calls.reduce((n, c) => n + c.results, 0),
      e.ms ?? null,
      e.inputTokens ?? null,
      e.outputTokens ?? null,
      e.costUsd ?? null,
    );
  } catch (err) {
    console.error('[ask_log]', err instanceof Error ? err.message : err);
  }
}

// A user over the limit may keep retrying; only the first rejection of their day is kept,
// so the log stays bounded and `quota` counts people turned away, not retries
export function logQuotaRejection(db: DB, userId: string, question: string, now = new Date()): void {
  const dayStart = toDbTime(taipeiDayStart(taipeiDate(now)));
  try {
    const seen = db.prepare(`SELECT 1 FROM ask_log WHERE created_at >= ? AND user_id = ? AND outcome = 'quota'`).get(dayStart, userId);
    if (!seen) logAsk(db, { userId, question, outcome: 'quota' });
  } catch (err) {
    console.error('[ask_log]', err instanceof Error ? err.message : err);
  }
}
