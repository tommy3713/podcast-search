import { type DB, hasColumn, hasTable, toDbTime } from '../db.ts';
import type { ToolCallLog } from './agent.ts';
import { ADDRESS_SQL, ANON_SQL, isAnon } from './anon.ts';
import { type Rating, RATING_REASONS, type RatingReason } from './rating.ts';
import type { LoggedSource } from './record.ts';

export const USER_DAILY_LIMIT = 20;
export const SITE_DAILY_LIMIT = 500;
// Without a login (anon.ts): a few a day per visitor, so they can try it before signing in,
// and a share of the site's cap, so the questions nobody vouches for (about US$0.01 each)
// stay within US$1 a day and can't use up what signed-in listeners get
export const ANON_DAILY_LIMIT = 2;
export const ANON_SITE_DAILY_LIMIT = 100;
// One network's questions without a login a day, however many cookies it clears (and however
// many people share its address: a mobile network's IPv4 is many people's)
export const ADDRESS_DAILY_LIMIT = 10;

// The day's limit for an account or a visitor
export function dailyLimit(userId: string): number {
  return isAnon(userId) ? ANON_DAILY_LIMIT : USER_DAILY_LIMIT;
}
// Nightly deletes ask_log rows older than this (and backups carry none); /about and /ask
// tell users so, so change all of them together by changing this
export const ASK_LOG_DAYS = 30;
// Nightly deletes ask_usage rows (the daily counts) older than this
export const USAGE_KEPT_DAYS = 7;

// Days reset at 00:00 Taipei (UTC+8, no DST)
export { taipeiDate } from '../format.ts';
import { taipeiDate } from '../format.ts';

// When a Taipei day (YYYY-MM-DD) starts, plusDays later. Format it for the column it is
// compared with: toDbTime for created_at, toISOString for published_at (which keeps ms).
export function taipeiDayStart(day: string, plusDays = 0): Date {
  return new Date(Date.parse(`${day}T00:00:00+08:00`) + plusDays * 86_400_000);
}

export function remaining(db: DB, userId: string, now = new Date()): number {
  const row = db.prepare('SELECT count FROM ask_usage WHERE user_id = ? AND date = ?').get(userId, taipeiDate(now)) as
    | { count: number }
    | undefined;
  return Math.max(0, dailyLimit(userId) - (row?.count ?? 0));
}

// anon_site: the day's questions without a login are used up; address: this network's are
// (signing in still works for both)
export type QuotaResult = { ok: true; remaining: number } | { ok: false; reason: 'user' | 'site' | 'anon_site' | 'address' };

const used = (db: DB, key: string, date: string) =>
  (db.prepare('SELECT count FROM ask_usage WHERE user_id = ? AND date = ?').get(key, date) as { count: number } | undefined)?.count ?? 0;
const charge = (db: DB, key: string, date: string) =>
  db
    .prepare(
      `INSERT INTO ask_usage (user_id, date, count) VALUES (?, ?, 1)
       ON CONFLICT (user_id, date) DO UPDATE SET count = count + 1`,
    )
    .run(key, date);

// Charged before calling any model, so a burst of requests can't overspend. A visitor without
// a login (anon.ts) is charged on their network's key too.
export function takeQuota(db: DB, userId: string, now = new Date(), address?: string): QuotaResult {
  const date = taipeiDate(now);
  return db.transaction((): QuotaResult => {
    if (siteUsed(db, date) >= SITE_DAILY_LIMIT) return { ok: false, reason: 'site' };
    const mine = used(db, userId, date);
    const limit = dailyLimit(userId);
    if (mine >= limit) return { ok: false, reason: 'user' };
    if (isAnon(userId)) {
      if (anonUsed(db, date) >= ANON_SITE_DAILY_LIMIT) return { ok: false, reason: 'anon_site' };
      if (!address || used(db, address, date) >= ADDRESS_DAILY_LIMIT) return { ok: false, reason: 'address' };
      charge(db, address, date);
    }
    charge(db, userId, date);
    return { ok: true, remaining: limit - mine - 1 };
  }).immediate();
}

// Questions asked without a login on a Taipei day
export function anonUsed(db: DB, date: string): number {
  return (db.prepare(`SELECT COALESCE(SUM(count), 0) AS n FROM ask_usage WHERE date = ? AND ${ANON_SQL()}`).get(date) as { n: number }).n;
}

// Questions and broadened ones the site answered on a Taipei day: the cap is on what it spends
function siteUsed(db: DB, date: string): number {
  // A visitor's question is on their row and their network's: counted once
  const asked = (db.prepare(`SELECT COALESCE(SUM(count), 0) AS n FROM ask_usage WHERE date = ? AND NOT ${ADDRESS_SQL()}`).get(date) as { n: number }).n;
  // Absent until the release that added 擴大搜尋 has migrated (a local snapshot, or mid-deploy)
  if (!hasTable(db, 'ask_retries')) return asked;
  return asked + (db.prepare('SELECT COUNT(*) AS n FROM ask_retries WHERE date = ?').get(date) as { n: number }).n;
}

// 擴大搜尋: the question it broadens, the words its searches used and the episodes its answer
// cited, all read from the log rather than taken from the browser
export type Broaden = { question: string; queries: string[]; citedEps: number[] };
export type RetryResult =
  | ({ ok: true } & Broaden)
  | { ok: false; reason: 'missing' | 'unfinished' | 'broad' | 'used' | 'site' | 'unavailable' };

// Free for the listener, counted toward the site's cap, once per question: the ask_retries
// row is taken before any model is called, in the same transaction as the checks, so two
// clicks at once get one answer. `missing`: not this account's question (or purged).
export function takeRetry(db: DB, userId: string, askId: number, now = new Date()): RetryResult {
  if (!hasTable(db, 'ask_retries') || !hasColumn(db, 'ask_log', 'retry_of')) {
    return { ok: false, reason: 'unavailable' };
  }
  const date = taipeiDate(now);
  return db.transaction((): RetryResult => {
    const row = db
      .prepare('SELECT user_id, question, outcome, retry_of, tool_calls_json, sources_json FROM ask_log WHERE id = ?')
      .get(askId) as
      | { user_id: string; question: string; outcome: string | null; retry_of: number | null; tool_calls_json: string | null; sources_json: string | null }
      | undefined;
    if (!row || row.user_id !== userId) return { ok: false, reason: 'missing' };
    if (row.outcome !== 'answered' && row.outcome !== 'no_source') return { ok: false, reason: 'unfinished' };
    if (row.retry_of !== null) return { ok: false, reason: 'broad' };
    if (db.prepare('SELECT 1 FROM ask_retries WHERE ask_id = ?').get(askId)) return { ok: false, reason: 'used' };
    if (siteUsed(db, date) >= SITE_DAILY_LIMIT) return { ok: false, reason: 'site' };
    db.prepare('INSERT INTO ask_retries (ask_id, date) VALUES (?, ?)').run(askId, date);
    return { ok: true, question: row.question, ...searchedBefore(row.tool_calls_json, row.sources_json) };
  }).immediate();
}

export type RateResult = { ok: true } | { ok: false; reason: 'missing' | 'unfinished' | 'unavailable' };

// A listener's 😀 / 🙁 on one of their own answers (a broad one too). A new rating replaces
// the last one whole: reasons and a note are kept only with bad, and only what was sent last.
// `missing`: not this account's question (or purged); `unfinished`: nothing was answered.
export function rateAsk(
  db: DB,
  userId: string,
  askId: number,
  r: { rating: Rating; reasons?: readonly RatingReason[]; note?: string | null },
  now = new Date(),
): RateResult {
  if (!hasColumn(db, 'ask_log', 'rating')) return { ok: false, reason: 'unavailable' };
  const bad = r.rating === 'bad';
  const reasons = bad ? RATING_REASONS.filter((x) => r.reasons?.includes(x)) : [];
  const note = bad ? r.note?.trim() || null : null;
  // One transaction, so the nightly purge can't take the row between the check and the write
  return db.transaction((): RateResult => {
    const row = db.prepare('SELECT user_id, outcome FROM ask_log WHERE id = ?').get(askId) as { user_id: string; outcome: string | null } | undefined;
    if (!row || row.user_id !== userId) return { ok: false, reason: 'missing' };
    if (row.outcome !== 'answered' && row.outcome !== 'no_source') return { ok: false, reason: 'unfinished' };
    db.prepare('UPDATE ask_log SET rating = ?, rating_reasons = ?, rating_note = ?, rated_at = ? WHERE id = ?').run(
      r.rating,
      reasons.length ? JSON.stringify(reasons) : null,
      note,
      toDbTime(now),
      askId,
    );
    return { ok: true };
  }).immediate();
}

// Given back when the broad answer failed for reasons that aren't the user's, so they can try again
export function refundRetry(db: DB, askId: number): void {
  db.prepare('DELETE FROM ask_retries WHERE ask_id = ?').run(askId);
}

// What the first answer searched for and cited. Both come from the model (its queries) or
// the transcripts (the sources), so they're data for the next prompt, never trusted shape.
// Exported for the eval's --broad, which builds the same from a run it just made.
export function searchedBefore(toolCalls: string | null, sources: string | null): Omit<Broaden, 'question'> {
  const parse = (json: string | null): unknown[] => {
    try {
      const v: unknown = json ? JSON.parse(json) : [];
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  const queries = new Set<string>();
  for (const c of parse(toolCalls)) {
    const args = (c as { args?: { query?: unknown; keyword?: unknown } } | null)?.args;
    for (const q of [args?.query, args?.keyword]) if (typeof q === 'string' && q.trim()) queries.add(q.trim().slice(0, 50));
  }
  const eps = new Set<number>();
  for (const s of parse(sources)) {
    const ep = (s as { ep?: unknown } | null)?.ep;
    if (Number.isInteger(ep)) eps.add(ep as number);
  }
  return { queries: [...queries].slice(0, 8), citedEps: [...eps].sort((a, b) => a - b) };
}

// Given back when the answer failed for reasons that aren't the user's
export function refundQuota(db: DB, userId: string, now = new Date(), address?: string): void {
  const refund = db.prepare('UPDATE ask_usage SET count = MAX(0, count - 1) WHERE user_id = ? AND date = ?');
  refund.run(userId, taipeiDate(now));
  if (address) refund.run(address, taipeiDate(now));
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
  sources?: LoggedSource[]; // the ones the answer cites
  retryOf?: number; // 擴大搜尋: the question this answer broadened
};

// Never throws: a logging failure must not fail the answer (and the web may write here
// moments before the worker's migration adds the columns: without sources_json the row is
// written without its sources rather than lost). Returns the row's id, null if it wasn't written.
export function logAsk(db: DB, e: AskLogEntry): number | null {
  try {
    const calls = e.toolCalls ?? [];
    const values: Record<string, unknown> = {
      user_id: e.userId,
      question: e.question,
      tool_calls_json: JSON.stringify(calls),
      outcome: e.outcome,
      answer: e.answer || null,
      cited: e.cited ?? null,
      hits: calls.reduce((n, c) => n + c.results, 0),
      ms: e.ms ?? null,
      input_tokens: e.inputTokens ?? null,
      output_tokens: e.outputTokens ?? null,
      cost_usd: e.costUsd ?? null,
    };
    if (hasColumn(db, 'ask_log', 'sources_json')) values.sources_json = e.sources?.length ? JSON.stringify(e.sources) : null;
    if (e.retryOf !== undefined && hasColumn(db, 'ask_log', 'retry_of')) values.retry_of = e.retryOf;
    const columns = Object.keys(values);
    const r = db.prepare(`INSERT INTO ask_log (${columns.join(', ')}) VALUES (${columns.map((c) => `@${c}`).join(', ')})`).run(values);
    return Number(r.lastInsertRowid);
  } catch (err) {
    console.error('[ask_log]', err instanceof Error ? err.message : err);
    return null;
  }
}

// A user over the limit may keep retrying; only the first rejection of their day is kept,
// so the log stays bounded and `quota` counts people turned away, not retries
export function logQuotaRejection(db: DB, userId: string, question: string, now = new Date()): void {
  // Visitors' ids cost nothing to make, so their rejections would be rows without end
  if (isAnon(userId)) return;
  const dayStart = toDbTime(taipeiDayStart(taipeiDate(now)));
  try {
    const seen = db.prepare(`SELECT 1 FROM ask_log WHERE created_at >= ? AND user_id = ? AND outcome = 'quota'`).get(dayStart, userId);
    if (!seen) logAsk(db, { userId, question, outcome: 'quota' });
  } catch (err) {
    console.error('[ask_log]', err instanceof Error ? err.message : err);
  }
}
