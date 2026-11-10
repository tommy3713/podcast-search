import { ASK_LOG_DAYS } from '@/lib/ask/quota.ts';
import { type DB, toDbTime } from '@/lib/db.ts';
import type { TaipeiTime } from './schedule.ts';

export function purgeAskLog(db: DB): number {
  const r = db.prepare(`DELETE FROM ask_log WHERE created_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?)`).run(`-${ASK_LOG_DAYS} days`);
  db.prepare(`DELETE FROM ask_usage WHERE date < date('now', '-7 days')`).run();
  return r.changes;
}

// /about and /ask promise questions and answers are gone after ASK_LOG_DAYS, text included,
// and a DELETE doesn't do that: the text stays readable in free pages, and pages that were
// split or rebalanced while rows were inserted keep stale copies of them in unused space
// (secure_delete only zeroes deleted cells, so it doesn't cover those). VACUUM rebuilds the
// file from the live rows only. The checkpoint then empties app.db-wal, which otherwise keeps
// the VACUUM's rewrite (and older pages) at its tail. Nightly after the purge, at 03:00: a
// few seconds at most for this database. Returns false when a reader in the middle of a
// transaction blocked the truncate; the next night tries again.
export function compactDb(db: DB): boolean {
  db.exec('VACUUM');
  const [r] = db.pragma('wal_checkpoint(TRUNCATE)') as { busy: number }[];
  return r?.busy === 0;
}

// ask_log.created_at is UTC; days are counted in Taipei time. Only used to label rows:
// filters compare created_at with UTC bounds, so the ask_log_created index applies.
const TAIPEI_DAY = `date(created_at, '+8 hours')`;
const taipeiMidnight = (day: string) => toDbTime(new Date(`${day}T00:00:00+08:00`));

// Rows from before outcomes were recorded have no outcome, cost or timing; counting
// them would show days with questions but no results
const RECORDED = `outcome IS NOT NULL`;

const TOTALS = `
  COUNT(*)                                                    AS asks,
  COUNT(DISTINCT user_id)                                     AS users,
  COALESCE(SUM(outcome = 'answered'), 0)                      AS answered,
  COALESCE(SUM(outcome = 'no_source'), 0)                     AS no_source,
  COALESCE(SUM(outcome = 'moderated'), 0)                     AS moderated,
  COALESCE(SUM(outcome = 'quota'), 0)                         AS quota,
  COALESCE(SUM(outcome IN ('timeout', 'aborted', 'error')), 0) AS failed,
  COALESCE(SUM(cost_usd), 0)                                  AS cost_usd,
  CAST(AVG(CASE WHEN outcome IN ('answered', 'no_source') THEN ms END) AS INTEGER) AS avg_ms`;

export type AskStats = {
  asks: number;
  users: number;
  answered: number;
  no_source: number;
  moderated: number;
  quota: number;
  failed: number;
  cost_usd: number;
  avg_ms: number | null;
};

export function askStats(db: DB, since: Date): AskStats {
  return db.prepare(`SELECT ${TOTALS} FROM ask_log WHERE created_at >= ? AND ${RECORDED}`).get(toDbTime(since)) as AskStats;
}

// Questions answered without citing any source: what listeners ask that the show
// (or the search) doesn't cover
export function unanswered(db: DB, since: Date, limit = 15): { day: string; question: string }[] {
  return db
    .prepare(`SELECT ${TAIPEI_DAY} AS day, question FROM ask_log WHERE outcome = 'no_source' AND created_at >= ? ORDER BY id DESC LIMIT ?`)
    .all(toDbTime(since), limit) as { day: string; question: string }[];
}

// Totals per Taipei day into ask_daily, which is kept after ask_log is purged at 30 days.
// Recomputes the last four weeks of finished days (cheap, and heals a missed night), but
// never older ones, whose rows the purge may already have thinned out.
export function rollupAskDaily(db: DB, today: string): void {
  db.prepare(
    `INSERT INTO ask_daily (date, asks, users, answered, no_source, moderated, quota, failed, cost_usd, avg_ms)
     SELECT ${TAIPEI_DAY} AS day, ${TOTALS}
     FROM ask_log
     WHERE created_at >= ? AND created_at < ? AND ${RECORDED}
     GROUP BY day
     ON CONFLICT (date) DO UPDATE SET
       asks = excluded.asks, users = excluded.users, answered = excluded.answered, no_source = excluded.no_source,
       moderated = excluded.moderated, quota = excluded.quota, failed = excluded.failed,
       cost_usd = excluded.cost_usd, avg_ms = excluded.avg_ms`,
  ).run(taipeiMidnight(addDays(today, -28)), taipeiMidnight(today));
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

// The weekly digest is due from Monday 09:00 until it has gone out for that week, so a
// busy queue or a restart over 09:00 delays it instead of skipping the week. Returns the
// week's Monday (the key to remember it by), or null when nothing is due.
export function digestDue(t: TaipeiTime, lastSent: string | null): string | null {
  const monday = addDays(t.date, -((t.weekday + 6) % 7));
  if (t.weekday === 1 && t.hour < 9) return null;
  return lastSent === monday ? null : monday;
}

export function formatStats(title: string, s: AskStats, questions: { day: string; question: string }[] = []): string {
  const lines = [
    `📊 ${title}`,
    `共 ${s.asks} 題・${s.users} 人`,
    `✅ 有出處 ${s.answered}・❓ 沒出處 ${s.no_source}・🚫 不當內容 ${s.moderated}・⛔ 配額已滿 ${s.quota}・❌ 失敗 ${s.failed}`,
    `成本 US$${s.cost_usd.toFixed(2)}${s.avg_ms !== null ? `・平均 ${(s.avg_ms / 1000).toFixed(1)} 秒` : ''}`,
  ];
  if (questions.length) {
    lines.push('', '❓ 沒有出處的問題：', ...questions.map((q) => `・${q.day.slice(5)} ${q.question.slice(0, 60)}`));
  }
  return lines.join('\n');
}

const OUTCOME_ICON: Record<string, string> = {
  answered: '✅',
  no_source: '❓',
  moderated: '🚫',
  quota: '⛔',
  timeout: '❌',
  aborted: '❌',
  error: '❌',
};
const icon = (outcome: string | null) => (outcome ? (OUTCOME_ICON[outcome] ?? '·') : '·');
// Users are a Google account id; the first characters are enough to tell them apart
const who = (userId: string) => userId.slice(0, 6);
const taipeiMinute = (createdAt: string) => new Date(Date.parse(createdAt) + 8 * 3600_000).toISOString().slice(5, 16).replace('T', ' ');

export type QuestionRow = { id: number; created_at: string; user_id: string; outcome: string | null; question: string };

export function recentQuestions(db: DB, limit: number): QuestionRow[] {
  return db.prepare('SELECT id, created_at, user_id, outcome, question FROM ask_log ORDER BY id DESC LIMIT ?').all(limit) as QuestionRow[];
}

export function formatQuestions(rows: QuestionRow[]): string {
  if (!rows.length) return '還沒有人問過問題（紀錄保留 30 天）';
  return [
    `💬 最近 ${rows.length} 題（✅ 有出處 ❓ 沒出處 🚫 不當內容 ⛔ 配額已滿 ❌ 失敗）`,
    ...rows.map((r) => `#${r.id} ${taipeiMinute(r.created_at)} ${who(r.user_id)} ${icon(r.outcome)} ${r.question.slice(0, 60)}`),
    '',
    '點下面的編號看完整回答',
  ].join('\n');
}

type AskRow = QuestionRow & {
  answer: string | null;
  cited: number | null;
  ms: number | null;
  cost_usd: number | null;
  tool_calls_json: string | null;
};

// One question in full, for the buttons under /questions. Telegram caps a message at 4096
// characters, so a long answer is cut.
export function formatAsk(db: DB, id: number): string {
  const r = db
    .prepare('SELECT id, created_at, user_id, outcome, question, answer, cited, ms, cost_usd, tool_calls_json FROM ask_log WHERE id = ?')
    .get(id) as AskRow | undefined;
  if (!r) return `找不到 #${id}（紀錄保留 30 天）`;
  const calls = JSON.parse(r.tool_calls_json ?? '[]') as { args?: Record<string, unknown>; results?: number }[];
  const searches = calls.map((c) => `${Object.values(c.args ?? {}).filter(Boolean).join(' ')}（${c.results ?? 0} 筆）`).join('、');
  const facts = [
    `${icon(r.outcome)} ${r.outcome ?? '—'}`,
    r.cited !== null ? `引用 ${r.cited}` : null,
    r.ms !== null ? `${(r.ms / 1000).toFixed(1)} 秒` : null,
    r.cost_usd !== null ? `US$${r.cost_usd.toFixed(4)}` : null,
  ].filter(Boolean);
  const head = [`#${r.id} ${taipeiMinute(r.created_at)} ${who(r.user_id)}`, `問：${r.question}`, facts.join('・'), searches ? `搜尋：${searches}` : null]
    .filter(Boolean)
    .join('\n');
  const answer = r.answer ?? '（沒有回答）';
  const room = 4000 - head.length - 10;
  return `${head}\n\n答：${answer.length > room ? `${answer.slice(0, room)}…` : answer}`;
}
