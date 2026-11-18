import { type AskStats, NOTE_LABEL, ratingColumns, RECORDED, searchSteps, shortUser, totals } from '@/lib/ask/log.ts';
import { ANON_SITE_DAILY_LIMIT, ASK_LOG_DAYS, taipeiDayStart, USAGE_KEPT_DAYS } from '@/lib/ask/quota.ts';
import { isRating, parseReasons, RATING_ICON, reasonText } from '@/lib/ask/rating.ts';
import { type DB, hasColumn, hasTable, toDbTime } from '@/lib/db.ts';
import type { TaipeiTime } from './schedule.ts';

export function purgeAskLog(db: DB): number {
  const r = db.prepare(`DELETE FROM ask_log WHERE created_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?)`).run(`-${ASK_LOG_DAYS} days`);
  db.prepare(`DELETE FROM ask_usage WHERE date < date('now', '-${USAGE_KEPT_DAYS} days')`).run();
  // Broadened questions go with the questions (absent before the release that added it)
  if (hasTable(db, 'ask_retries')) {
    db.prepare('DELETE FROM ask_retries WHERE ask_id NOT IN (SELECT id FROM ask_log)').run();
  }
  return r.changes;
}

// /about and /ask promise questions and answers are gone after ASK_LOG_DAYS, text included,
// and a DELETE doesn't do that: the text stays readable in free pages, and pages that were
// split or rebalanced while rows were inserted keep stale copies of them in unused space
// (secure_delete only zeroes deleted cells, so it doesn't cover those). VACUUM rebuilds the
// file from the live rows only, so it runs on nights the purge removed rows (stale copies of
// a row only matter once it's purged); the whole nightly took under a second on the live
// database (9.7 MB, 84 episodes). The checkpoint runs every night: it empties app.db-wal,
// which otherwise keeps the VACUUM's rewrite and older pages at its tail. Returns a problem
// when a reader still in a transaction after busy_timeout blocked the truncate.
export function compactDb(db: DB, purged: number): string | null {
  if (purged > 0) db.exec('VACUUM');
  const [r] = db.pragma('wal_checkpoint(TRUNCATE)') as { busy: number }[];
  return r?.busy === 0 ? null : '清空 app.db-wal 被讀取中的連線擋住，刪掉的問答可能還留在裡面（明晚再試）';
}

// ask_log.created_at is UTC; days are counted in Taipei time. Only used to label rows:
// filters compare created_at with UTC bounds, so the ask_log_created index applies.
const TAIPEI_DAY = `date(created_at, '+8 hours')`;
const taipeiMidnight = (day: string) => toDbTime(taipeiDayStart(day));

// Questions answered without citing any source: what listeners ask that the show
// (or the search) doesn't cover
export function unanswered(db: DB, since: Date, limit = 15): { day: string; question: string }[] {
  return db
    // A broad answer repeats its question, which is listed (or answered) once already
    .prepare(`SELECT ${TAIPEI_DAY} AS day, question FROM ask_log WHERE outcome = 'no_source' AND created_at >= ?${hasColumn(db, 'ask_log', 'retry_of') ? ' AND retry_of IS NULL' : ''} ORDER BY id DESC LIMIT ?`)
    .all(toDbTime(since), limit) as { day: string; question: string }[];
}

// Answers rated 🙁, newest first, with why: what to look at first in /admin/asks
export type Disliked = { day: string; id: number; question: string; reasons: string; note: boolean };
export function disliked(db: DB, since: Date, limit = 15): Disliked[] {
  if (!hasColumn(db, 'ask_log', 'rating')) return [];
  const rows = db
    .prepare(`SELECT ${TAIPEI_DAY} AS day, id, question, rating_reasons, rating_note FROM ask_log WHERE rating = 'bad' AND created_at >= ? ORDER BY id DESC LIMIT ?`)
    .all(toDbTime(since), limit) as { day: string; id: number; question: string; rating_reasons: string | null; rating_note: string | null }[];
  return rows.map((r) => ({
    day: r.day,
    id: r.id,
    question: r.question,
    reasons: reasonText(parseReasons(r.rating_reasons)),
    note: !!r.rating_note,
  }));
}

// Totals per Taipei day into ask_daily, which is kept after ask_log is purged at ASK_LOG_DAYS.
// Recomputes the last four weeks of finished days (cheap, and heals a missed night), but
// never older ones, whose rows the purge may already have thinned out.
export function rollupAskDaily(db: DB, today: string): void {
  db.prepare(
    `INSERT INTO ask_daily (date, asks, users, answered, no_source, moderated, quota, failed, cost_usd, avg_ms, good, bad)
     SELECT ${TAIPEI_DAY} AS day, ${totals(db)}
     FROM ask_log
     WHERE created_at >= ? AND created_at < ? AND ${RECORDED}
     GROUP BY day
     ON CONFLICT (date) DO UPDATE SET
       asks = excluded.asks, users = excluded.users, answered = excluded.answered, no_source = excluded.no_source,
       moderated = excluded.moderated, quota = excluded.quota, failed = excluded.failed,
       cost_usd = excluded.cost_usd, avg_ms = excluded.avg_ms, good = excluded.good, bad = excluded.bad`,
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

export function formatStats(title: string, s: AskStats, questions: { day: string; question: string }[] = [], bad: Disliked[] = []): string {
  const lines = [
    `📊 ${title}`,
    `共 ${s.asks} 題・${s.users} 人`,
    // A visitor without a login is a new id each day, so `users` counts them once a day
    ...(s.anon
      ? [`👤 未登入 ${s.anon} 題${s.anonFull ? `・額度用滿 ${s.anonFull} 天（${ANON_SITE_DAILY_LIMIT} 題／天${s.anonFullCut ? `；只算得到最近 ${USAGE_KEPT_DAYS} 天` : ''}）` : ''}`]
      : []),
    `✅ 有出處 ${s.answered}・❓ 沒出處 ${s.no_source}・🚫 不當內容 ${s.moderated}・⛔ 配額已滿 ${s.quota}・❌ 失敗 ${s.failed}`,
    // Not among the questions above; their cost is in the line below
    ...(s.broad ? [`🔁 擴大搜尋 ${s.broad}（聽眾覺得第一次的回答不是他要的）`] : []),
    `成本 US$${s.cost_usd.toFixed(2)}${s.avg_ms !== null ? `・平均 ${(s.avg_ms / 1000).toFixed(1)} 秒` : ''}`,
    // Out of the finished answers (broad ones too), so how few bother to rate shows
    ...(s.good + s.bad
      ? [`評分 ${RATING_ICON.good} ${s.good}・${RATING_ICON.bad} ${s.bad}${s.rateable !== undefined ? `（${s.rateable} 個回答中）` : ''}`]
      : []),
  ];
  if (questions.length) {
    lines.push('', '❓ 沒有出處的問題：', ...questions.map((q) => `・${q.day.slice(5)} ${q.question.slice(0, 60)}`));
  }
  if (bad.length) {
    lines.push(
      '',
      `${RATING_ICON.bad} 不滿意的回答（📝 有補充說明）：`,
      ...bad.map((q) => `・#${q.id} ${q.day.slice(5)} ${q.question.slice(0, 60)}${q.reasons ? `（${q.reasons}）` : ''}${q.note ? ' 📝' : ''}`),
    );
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
const taipeiMinute = (createdAt: string) => new Date(Date.parse(createdAt) + 8 * 3600_000).toISOString().slice(5, 16).replace('T', ' ');

export type QuestionRow = { id: number; created_at: string; user_id: string; outcome: string | null; question: string; rating?: string | null };

const ratingIcon = (rating: string | null | undefined) => (isRating(rating) ? ` ${RATING_ICON[rating]}` : '');

export function recentQuestions(db: DB, limit: number): QuestionRow[] {
  return db.prepare(`SELECT id, created_at, user_id, outcome, question, ${ratingColumns(db)} FROM ask_log ORDER BY id DESC LIMIT ?`).all(limit) as QuestionRow[];
}

export function formatQuestions(rows: QuestionRow[]): string {
  if (!rows.length) return `還沒有人問過問題（紀錄保留 ${ASK_LOG_DAYS} 天）`;
  return [
    `💬 最近 ${rows.length} 題（✅ 有出處 ❓ 沒出處 🚫 不當內容 ⛔ 配額已滿 ❌ 失敗；聽眾評分 ${RATING_ICON.good} ${RATING_ICON.bad}）`,
    ...rows.map((r) => `#${r.id} ${taipeiMinute(r.created_at)} ${shortUser(r.user_id)} ${icon(r.outcome)}${ratingIcon(r.rating)} ${r.question.slice(0, 60)}`),
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
  rating: string | null;
  rating_reasons: string | null;
  rating_note: string | null;
};

// One question in full, for the buttons under /questions. Telegram caps a message at 4096
// characters, so a long answer is cut.
export function formatAsk(db: DB, id: number): string {
  const r = db
    .prepare(
      `SELECT id, created_at, user_id, outcome, question, answer, cited, ms, cost_usd, tool_calls_json,
              ${ratingColumns(db)}
       FROM ask_log WHERE id = ?`,
    )
    .get(id) as AskRow | undefined;
  if (!r) return `找不到 #${id}（紀錄保留 ${ASK_LOG_DAYS} 天）`;
  const searches = searchSteps(r.tool_calls_json)
    .map((c) => `${c.what}（${c.results} 筆${c.cut.length ? `，${c.cut.map((t) => `「${t}」`).join('')}${NOTE_LABEL.cut}` : ''}${c.unmatched ? `，${NOTE_LABEL.unmatched}` : ''}${c.sound.length ? `，${c.sound.map((t) => `「${t}」`).join('')}${NOTE_LABEL.sound}` : ''}）`)
    .join('、');
  const facts = [
    `${icon(r.outcome)} ${r.outcome ?? '—'}`,
    r.cited !== null ? `引用 ${r.cited}` : null,
    r.ms !== null ? `${(r.ms / 1000).toFixed(1)} 秒` : null,
    r.cost_usd !== null ? `US$${r.cost_usd.toFixed(4)}` : null,
  ].filter(Boolean);
  const reasons = reasonText(parseReasons(r.rating_reasons));
  const rated = isRating(r.rating)
    ? `評分：${RATING_ICON[r.rating]}${reasons ? ` ${reasons}` : ''}${r.rating_note ? `\n聽眾說：${r.rating_note}` : ''}`
    : null;
  const head = [`#${r.id} ${taipeiMinute(r.created_at)} ${shortUser(r.user_id)}`, `問：${r.question}`, facts.join('・'), searches ? `搜尋：${searches}` : null, rated]
    .filter(Boolean)
    .join('\n');
  const answer = r.answer ?? '（沒有回答）';
  const room = 4000 - head.length - 10;
  return `${head}\n\n答：${answer.length > room ? `${answer.slice(0, room)}…` : answer}`;
}
