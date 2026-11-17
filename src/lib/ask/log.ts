// Reading ask_log back: the Telegram bot's /stats and /questions and the admin's 問答紀錄
// page (/admin/asks) both come through here, so they count and describe questions alike.
// Rows are purged after ASK_LOG_DAYS; nothing here keeps anything longer.
import { createHash } from 'node:crypto';
import { type DB, hasColumn, toDbTime } from '../db.ts';
import { likePattern } from '../fts.ts';
import { taipeiDate, taipeiDayStart } from './quota.ts';
import { isRating, parseReasons, type Rating, type RatingReason } from './rating.ts';
import type { LoggedSource } from './record.ts';
import { describeMentionSearch, describeTranscriptSearch } from './search.ts';

// ── Totals ────────────────────────────────────────────────────────────────────────────

// Rows from before outcomes were recorded have no outcome, cost or timing; counting
// them would show days with questions but no results
export const RECORDED = `outcome IS NOT NULL`;

// A 擴大搜尋 answer is a second answer to a question already counted, so it isn't a question,
// a user, an outcome or a time here (counted on its own as `broad`), but what it cost is
// spent all the same. Rows of a database without the column are all first answers.
// Ratings count every rated answer, a broad one too: each is an answer the listener judged.
export function totals(db: DB): string {
  const first = hasColumn(db, 'ask_log', 'retry_of') ? 'retry_of IS NULL' : '1';
  const rated = hasColumn(db, 'ask_log', 'rating');
  return `
  COALESCE(SUM(${first}), 0)                                              AS asks,
  COUNT(DISTINCT CASE WHEN ${first} THEN user_id END)                     AS users,
  COALESCE(SUM(${first} AND outcome = 'answered'), 0)                     AS answered,
  COALESCE(SUM(${first} AND outcome = 'no_source'), 0)                    AS no_source,
  COALESCE(SUM(${first} AND outcome = 'moderated'), 0)                    AS moderated,
  COALESCE(SUM(${first} AND outcome = 'quota'), 0)                        AS quota,
  COALESCE(SUM(${first} AND outcome IN ('timeout', 'aborted', 'error')), 0) AS failed,
  COALESCE(SUM(cost_usd), 0)                                              AS cost_usd,
  CAST(AVG(CASE WHEN ${first} AND outcome IN ('answered', 'no_source') THEN ms END) AS INTEGER) AS avg_ms,
  ${rated ? `COALESCE(SUM(rating = 'good'), 0)` : '0'}                     AS good,
  ${rated ? `COALESCE(SUM(rating = 'bad'), 0)` : '0'}                      AS bad`;
}

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
  broad?: number; // 擴大搜尋 answers, not among `asks` (absent where the column isn't); their cost is in cost_usd
  good: number; // answers rated 😀 / 🙁 (a broad one too)
  bad: number;
  rateable?: number; // finished answers (a broad one too): what good and bad are out of (askStats only)
};

export function askStats(db: DB, since: Date): AskStats {
  const s = db.prepare(`SELECT ${totals(db)} FROM ask_log WHERE created_at >= ? AND ${RECORDED}`).get(toDbTime(since)) as AskStats;
  const { rateable } = db
    .prepare(`SELECT COUNT(*) AS rateable FROM ask_log WHERE created_at >= ? AND outcome IN ('answered', 'no_source')`)
    .get(toDbTime(since)) as { rateable: number };
  if (!hasColumn(db, 'ask_log', 'retry_of')) return { ...s, rateable };
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ask_log WHERE created_at >= ? AND ${RECORDED} AND retry_of IS NOT NULL`).get(toDbTime(since)) as { n: number };
  return { ...s, broad: n, rateable };
}

export type AskDay = { date: string; asks: number; answered: number; no_source: number; failed: number; good: number; bad: number };

// The `days` finished Taipei days before `today` from ask_daily (rolled up nightly, kept after
// the rows are purged), oldest first. A day nobody asked on has no row; it comes back as
// null so a chart leaves a gap of the right width instead of closing it up.
export function askDays(db: DB, days: number, today = taipeiDate()): { date: string; day: AskDay | null }[] {
  const dates = Array.from({ length: days }, (_, i) =>
    new Date(Date.parse(`${today}T00:00:00Z`) - (days - i) * 86_400_000).toISOString().slice(0, 10),
  );
  const rows = db
    // good / bad: 0 on a snapshot from before ratings
    .prepare(
      `SELECT date, asks, answered, no_source, failed, ${hasColumn(db, 'ask_daily', 'good') ? 'good, bad' : '0 AS good, 0 AS bad'}
       FROM ask_daily WHERE date >= ? AND date < ?`,
    )
    .all(dates[0], today) as AskDay[];
  const byDate = new Map(rows.map((r) => [r.date, r]));
  return dates.map((date) => ({ date, day: byDate.get(date) ?? null }));
}

// ── Outcomes ──────────────────────────────────────────────────────────────────────────

export const OUTCOMES = ['answered', 'no_source', 'moderated', 'quota', 'timeout', 'aborted', 'error'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABEL: Record<Outcome, string> = {
  answered: '有出處',
  no_source: '沒出處',
  moderated: '不當內容',
  quota: '配額已滿',
  timeout: '逾時',
  aborted: '中斷',
  error: '錯誤',
};

// Users are a Google account id. Telegram shows its first characters; the admin page shows a
// tag hashed from the whole id instead, since Google ids mostly start 10 or 11, which leaves
// few characters to tell people apart. Neither shows the id.
export const shortUser = (userId: string) => userId.slice(0, 6);
export const userTag = (userId: string) => createHash('sha256').update(userId).digest('hex').slice(0, 6);

// ── Searches ──────────────────────────────────────────────────────────────────────────

// The notes a search can carry, as the list, a question's page and Telegram word them
export const NOTE_LABEL = { cut: '超過讀取上限', unmatched: '關鍵字都沒對到', sound: '靠發音找到' } as const;
export type Note = keyof typeof NOTE_LABEL;

type LoggedCall = { name?: string; args?: Record<string, unknown> | string; results?: number; cut?: string[]; unmatched?: boolean; sound?: string[] };

export type SearchStep = {
  tool: 'transcript' | 'mentions' | 'other';
  what: string; // the query and its scope
  query: string | null; // a transcript search's query as the model sent it
  results: number;
  cut: string[]; // keyword terms that matched more chunks than one read takes
  unmatched: boolean; // no term of the query is in any episode
  sound: string[]; // terms found only by how they sound
};

const describe: Record<string, (a: Record<string, unknown>) => string> = {
  search_mentions: describeMentionSearch,
  search_transcript: describeTranscriptSearch,
};

function loggedCalls(json: string | null): LoggedCall[] {
  try {
    const parsed: unknown = JSON.parse(json ?? '[]');
    return Array.isArray(parsed) ? (parsed as LoggedCall[]).filter((c) => c && typeof c === 'object') : [];
  } catch {
    return [];
  }
}

// Which notes any of a question's searches carried (the list needs only these)
export function searchNotes(json: string | null): Note[] {
  const calls = loggedCalls(json);
  return (Object.keys(NOTE_LABEL) as Note[]).filter((k) => calls.some((c) => (k === 'unmatched' ? !!c.unmatched : !!c[k]?.length)));
}

// The model's tool calls as logged. args is the raw string when the model's JSON didn't parse.
export function searchSteps(json: string | null): SearchStep[] {
  return loggedCalls(json).map(({ name, args, results, cut, unmatched, sound }) => ({
    tool: name === 'search_transcript' ? 'transcript' : name === 'search_mentions' ? 'mentions' : 'other',
    what:
      typeof args === 'string'
        ? args
        : args && name && describe[name]
          ? describe[name]!(args)
          : Object.values(args ?? {}).filter(Boolean).join(' '),
    query: name === 'search_transcript' && args && typeof args === 'object' && typeof args.query === 'string' ? args.query : null,
    results: results ?? 0,
    cut: cut ?? [],
    unmatched: !!unmatched,
    sound: sound ?? [],
  }));
}

// ── The list on /admin/asks ───────────────────────────────────────────────────────────

// failed: timeout, aborted or error, as the totals count them
export type OutcomeFilter = Outcome | 'failed';
// cut / unmatched / sound: a search that hit that note; slow: over SLOW_MS; broad: a 擴大搜尋 answer
export type FlagFilter = Note | 'slow' | 'broad';
export const SLOW_MS = 15_000;

export type AskFilter = {
  outcome?: OutcomeFilter;
  q?: string; // in the question or the answer
  since?: string; // Taipei days, both ends included
  until?: string;
  of?: number; // the account that asked this question (by question, so the id never shows)
  flag?: FlagFilter;
  rating?: Rating | 'none'; // none: a finished answer nobody rated
};

export type AskListRow = {
  id: number;
  createdAt: string;
  user: string; // userTag
  outcome: string | null;
  question: string;
  cited: number | null;
  ms: number | null;
  costUsd: number | null;
  flags: Note[];
  retryOf: number | null; // 擴大搜尋: the question this answer broadened
  broadenedBy: number | null; // the newest 擴大搜尋 answer to this question (a failed one can be tried again)
  rating: Rating | null; // the listener's 😀 / 🙁
  reasons: RatingReason[]; // with 🙁, why (may be none)
  hasNote: boolean; // with 🙁, a note
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (s: string | undefined): s is string => !!s && DAY.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

// Reads the page's query string; anything it doesn't recognise is left out, not an error
export function parseAskFilter(p: Record<string, string | string[] | undefined>): AskFilter {
  const one = (k: string) => {
    const v = p[k];
    const s = (Array.isArray(v) ? v[0] : v)?.trim();
    return s ? s : undefined;
  };
  const f: AskFilter = {};
  const outcome = one('outcome');
  if (outcome && (outcome === 'failed' || (OUTCOMES as readonly string[]).includes(outcome))) f.outcome = outcome as OutcomeFilter;
  const q = one('q');
  if (q) f.q = q.slice(0, 100);
  const since = one('since');
  if (isDay(since)) f.since = since;
  const until = one('until');
  if (isDay(until)) f.until = until;
  const of = one('of');
  if (of && /^\d{1,12}$/.test(of)) f.of = Number(of);
  const flag = one('flag');
  if (flag === 'cut' || flag === 'unmatched' || flag === 'sound' || flag === 'slow' || flag === 'broad') f.flag = flag;
  const rating = one('rating');
  if (isRating(rating) || rating === 'none') f.rating = rating;
  return f;
}

// A logged call carrying that note (the key is only written when it applies)
const hasNote = (key: 'cut' | 'unmatched' | 'sound') =>
  `(json_valid(tool_calls_json) AND EXISTS (SELECT 1 FROM json_each(tool_calls_json) WHERE json_type(value, '$.${key}') IS NOT NULL))`;

function whereOf(db: DB, f: AskFilter): { where: string; params: unknown[] } {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (f.outcome === 'failed') conds.push(`outcome IN ('timeout', 'aborted', 'error')`);
  else if (f.outcome) {
    conds.push('outcome = ?');
    params.push(f.outcome);
  }
  if (f.q) {
    conds.push(`(question LIKE ? ESCAPE '\\' OR answer LIKE ? ESCAPE '\\')`);
    params.push(likePattern(f.q), likePattern(f.q));
  }
  // created_at is UTC; compared with UTC bounds so the ask_log_created index applies
  if (f.since) {
    conds.push('created_at >= ?');
    params.push(toDbTime(taipeiDayStart(f.since)));
  }
  if (f.until) {
    conds.push('created_at < ?');
    params.push(toDbTime(taipeiDayStart(f.until, 1)));
  }
  if (f.of !== undefined) {
    // A purged question matches nothing
    conds.push('user_id = (SELECT user_id FROM ask_log WHERE id = ?)');
    params.push(f.of);
  }
  if (f.flag === 'slow') {
    conds.push('ms > ?');
    params.push(SLOW_MS);
  } else if (f.flag === 'broad') conds.push(hasColumn(db, 'ask_log', 'retry_of') ? 'retry_of IS NOT NULL' : '0');
  else if (f.flag) conds.push(hasNote(f.flag));
  // A snapshot from before ratings has none, so only `none` matches there
  const rated = hasColumn(db, 'ask_log', 'rating');
  if (f.rating === 'none') conds.push(`outcome IN ('answered', 'no_source')${rated ? ' AND rating IS NULL' : ''}`);
  else if (f.rating) {
    conds.push(rated ? 'rating = ?' : '0');
    if (rated) params.push(f.rating);
  }
  return { where: conds.length ? conds.join(' AND ') : '1', params };
}

type ListSqlRow = {
  id: number;
  created_at: string;
  user_id: string;
  outcome: string | null;
  question: string;
  cited: number | null;
  ms: number | null;
  cost_usd: number | null;
  tool_calls_json: string | null;
  retry_of: number | null;
  broadened_by: number | null;
  rating: string | null;
  rating_reasons: string | null;
  rating_note: string | null;
};

// 擴大搜尋 links both ways; a snapshot from before it has neither
const broadColumns = (db: DB) =>
  hasColumn(db, 'ask_log', 'retry_of')
    ? 'retry_of, (SELECT b.id FROM ask_log b WHERE b.retry_of = ask_log.id ORDER BY b.id DESC LIMIT 1) AS broadened_by'
    : 'NULL AS retry_of, NULL AS broadened_by';

// The listener's rating; a snapshot from before it has none (Telegram's /questions reads it too)
export const ratingColumns = (db: DB) =>
  hasColumn(db, 'ask_log', 'rating')
    ? 'rating, rating_reasons, rating_note, rated_at'
    : 'NULL AS rating, NULL AS rating_reasons, NULL AS rating_note, NULL AS rated_at';
const ratingOf = (r: Pick<ListSqlRow, 'rating' | 'rating_reasons'>) => ({
  rating: isRating(r.rating) ? r.rating : null,
  reasons: parseReasons(r.rating_reasons),
});

// Newest first, `limit` at a time; `before` is the last id of the page before (keyset, so a
// question logged while paging doesn't shift the pages). next is the id to pass for the
// page after, null on the last one.
export function listAsks(db: DB, f: AskFilter, before: number | null = null, limit = 50): { rows: AskListRow[]; next: number | null; total: number } {
  const { where, params } = whereOf(db, f);
  const page = db
    .prepare(
      `SELECT id, created_at, user_id, outcome, question, cited, ms, cost_usd, tool_calls_json, ${broadColumns(db)}, ${ratingColumns(db)}
       FROM ask_log WHERE ${where} AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?`,
    )
    .all(...params, before, before, limit + 1) as ListSqlRow[];
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM ask_log WHERE ${where}`).get(...params) as { total: number };
  const more = page.length > limit;
  const rows = page.slice(0, limit).map(
    (r): AskListRow => ({
      id: r.id,
      createdAt: r.created_at,
      user: userTag(r.user_id),
      outcome: r.outcome,
      question: r.question,
      cited: r.cited,
      ms: r.ms,
      costUsd: r.cost_usd,
      flags: searchNotes(r.tool_calls_json),
      retryOf: r.retry_of,
      broadenedBy: r.broadened_by,
      ...ratingOf(r),
      hasNote: !!r.rating_note,
    }),
  );
  return { rows, next: more ? rows.at(-1)!.id : null, total };
}

// ── One question ──────────────────────────────────────────────────────────────────────

export type AskDetail = {
  id: number;
  createdAt: string;
  user: string;
  outcome: string | null;
  question: string;
  answer: string | null; // as the page showed it, episode labels included
  cited: number | null;
  hits: number | null;
  ms: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  steps: SearchStep[];
  // The sources the answer cites, in the order first cited; null when the row has none
  // (logged before they were kept, never answered, or a snapshot without the column)
  sources: LoggedSource[] | null;
  sourcesBroken: boolean; // sources_json held entries that don't read as sources
  newer: number | null; // the neighbouring questions, for paging through them one by one
  older: number | null;
  retryOf: number | null; // 擴大搜尋, both ways (see AskListRow)
  broadenedBy: number | null;
  rating: Rating | null; // the listener's 😀 / 🙁, and with 🙁 why
  reasons: RatingReason[];
  ratingNote: string | null;
  ratedAt: string | null;
};

// What sources_json held: the sources, nothing (a row from before it, or never answered),
// or a value that doesn't read as sources
function parseSources(json: string | null): { sources: LoggedSource[] | null; broken: boolean } {
  if (!json) return { sources: null, broken: false };
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return { sources: null, broken: true };
    const ok = parsed.filter(
      (s): s is LoggedSource =>
        !!s && typeof s === 'object' && Number.isInteger(s.n) && Number.isInteger(s.ep) && typeof s.t === 'number' && typeof s.text === 'string',
    );
    return {
      sources: ok.length ? ok.map((s) => ({ ...s, label: typeof s.label === 'string' ? s.label : null })) : null,
      broken: ok.length < parsed.length,
    };
  } catch {
    return { sources: null, broken: true };
  }
}

export function getAsk(db: DB, id: number): AskDetail | null {
  const r = db
    .prepare(
      `SELECT id, created_at, user_id, outcome, question, answer, cited, hits, ms, input_tokens, output_tokens, cost_usd, tool_calls_json,
              ${hasColumn(db, 'ask_log', 'sources_json') ? 'sources_json' : 'NULL AS sources_json'}, ${broadColumns(db)}, ${ratingColumns(db)}
       FROM ask_log WHERE id = ?`,
    )
    .get(id) as
    | (ListSqlRow & {
        answer: string | null;
        hits: number | null;
        input_tokens: number | null;
        output_tokens: number | null;
        sources_json: string | null;
        rated_at: string | null;
      })
    | undefined;
  if (!r) return null;
  const newer = db.prepare('SELECT min(id) AS id FROM ask_log WHERE id > ?').get(id) as { id: number | null };
  const older = db.prepare('SELECT max(id) AS id FROM ask_log WHERE id < ?').get(id) as { id: number | null };
  return {
    id: r.id,
    createdAt: r.created_at,
    user: userTag(r.user_id),
    outcome: r.outcome,
    question: r.question,
    answer: r.answer,
    cited: r.cited,
    hits: r.hits,
    ms: r.ms,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    costUsd: r.cost_usd,
    steps: searchSteps(r.tool_calls_json),
    ...((p) => ({ sources: p.sources, sourcesBroken: p.broken }))(parseSources(r.sources_json)),
    newer: newer.id,
    older: older.id,
    retryOf: r.retry_of,
    broadenedBy: r.broadened_by,
    ...ratingOf(r),
    ratingNote: r.rating_note,
    ratedAt: r.rated_at,
  };
}

// ── A golden question from a logged one ───────────────────────────────────────────────

// Each citing line of a logged answer opens with its episodes' label (blocksToText):
// "EP709｜", "- EP700・EP701｜", or "EP700・EP701・EP702 等 5 集｜" when it names only some
const LINE_LABEL = /^(?:- )?((?:EP\d{1,4}・)*EP\d{1,4})(?: 等 \d+ 集)?｜/gm;

// A starting point for evals/golden.jsonl, or null when the question wasn't answered either
// way (timeout, error, moderated, quota: nothing to say what a right answer is). The episodes
// are those of the cited sources when the row kept them, else the ones the labels name, and
// then `partial` when a label left some out. The question is a listener's words, kept
// ASK_LOG_DAYS like the rest of the log, so it goes into the repo only reworded.
export function goldenDraft(
  a: Pick<AskDetail, 'outcome' | 'question' | 'answer' | 'steps'> & { sources?: LoggedSource[] | null },
): { line: string; partial: boolean } | null {
  if (a.outcome !== 'answered' && a.outcome !== 'no_source') return null;
  const refuse = a.outcome === 'no_source';
  const eps = new Set<number>();
  let partial = false;
  if (a.sources?.length) for (const s of a.sources) eps.add(s.ep);
  else
    for (const m of (a.answer ?? '').matchAll(LINE_LABEL)) {
      for (const ep of m[1]!.split('・')) eps.add(Number(ep.slice(2)));
      if (m[0].includes(' 等 ')) partial = true;
    }
  const queries = [...new Set(a.steps.map((s) => s.query).filter((q): q is string => !!q))];
  const line = JSON.stringify({
    id: refuse ? 'nf-XX' : 'detail-XX',
    type: refuse ? 'not_found' : 'detail',
    question: a.question,
    expect_eps: refuse ? [] : [...eps].sort((x, y) => y - x),
    queries,
    points: [],
    must_not: [],
    refuse,
  });
  return { line, partial: !refuse && partial };
}
