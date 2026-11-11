import type { DB } from '../db.ts';
import { taipeiDayStart } from './quota.ts';
import { toVecBlob } from '../db.ts';

export type TranscriptHit = { episodeNo: number; publishedAt: string; startSec: number; text: string };
export type MentionHit = {
  episodeNo: number;
  publishedAt: string;
  startSec: number;
  category: string;
  name: string;
  code: string | null;
  detail: string | null;
  quote: string | null;
};

const RRF_K = 60;
const MAX_TERMS = 5;
// How many matching chunks keyword search reads per term, and how many mentions one search
// returns. Exported so the eval can report the questions whose terms go over them.
export const TERM_MATCH_LIMIT = 200;
export const MENTION_LIMIT = 30;

// Words in the model's query. Trigram FTS needs 3+ characters, so shorter terms such as
// 苗栗 fall back to LIKE; with a few thousand chunks a scan takes milliseconds.
export function queryTerms(query: string): string[] {
  return [...new Set(query.split(/[\s,，、]+/).map((t) => t.trim()).filter(Boolean))].slice(0, MAX_TERMS);
}

const ftsPhrase = (term: string) => `"${term.replace(/"/g, '""')}"`;
export const likePattern = (term: string) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

// One episode or a range of Taipei days (both ends included), for either search
export type EpisodeScope = { episode?: number | null; since?: string | null; until?: string | null };

const hasScope = (s: EpisodeScope) => Boolean(s.episode || s.since || s.until);

// SQL on `episodes e` and its named parameters. published_at is an ISO time with ms, so
// the bounds are compared as toISOString(), not toDbTime().
function scopeSql(s: EpisodeScope): { where: string; params: Record<string, string | number | null> } {
  return {
    where: `(@episode IS NULL OR e.episode_no = @episode) AND (@since IS NULL OR e.published_at >= @since) AND (@until IS NULL OR e.published_at < @until)`,
    params: {
      episode: s.episode ?? null,
      since: s.since ? taipeiDayStart(s.since).toISOString() : null,
      until: s.until ? taipeiDayStart(s.until, 1).toISOString() : null,
    },
  };
}

// ` AND <col> IN (chunks of live episodes in the scope)`, or nothing without a scope. The
// filter sits inside each ranking's query, so the read limits apply within the scope
// rather than cutting it off.
function chunkFilter(scope: EpisodeScope, col: string) {
  if (!hasScope(scope)) return { sql: '', params: {} };
  const { where, params } = scopeSql(scope);
  return { sql: ` AND ${col} IN (SELECT c.id FROM chunks c JOIN episodes e ON e.id = c.episode_id WHERE e.status = 'done' AND ${where})`, params };
}

// Chunk ids ranked by how many query terms they contain, newest episode first on ties
function keywordRanking(db: DB, terms: string[], limit: number, scope: EpisodeScope = {}): number[] {
  const matches = new Map<number, number>();
  const ftsScope = chunkFilter(scope, 'rowid');
  const likeScope = chunkFilter(scope, 'id');
  const fts = db.prepare(`SELECT rowid AS id FROM chunks_fts WHERE chunks_fts MATCH @q${ftsScope.sql} LIMIT ${TERM_MATCH_LIMIT}`);
  const like = db.prepare(`SELECT id FROM chunks WHERE text LIKE @q ESCAPE '\\'${likeScope.sql} LIMIT ${TERM_MATCH_LIMIT}`);
  for (const term of terms) {
    const rows = (
      [...term].length >= 3 ? fts.all({ q: ftsPhrase(term), ...ftsScope.params }) : like.all({ q: likePattern(term), ...likeScope.params })
    ) as { id: number }[];
    for (const r of rows) matches.set(r.id, (matches.get(r.id) ?? 0) + 1);
  }
  if (!matches.size) return [];
  // Higher chunk id = later insert ≈ newer episode
  return [...matches.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]).slice(0, limit).map(([id]) => id);
}

// sqlite-vec (0.1.9) takes a rowid IN filter inside the KNN query itself
function vectorRanking(db: DB, embedding: number[], limit: number, scope: EpisodeScope = {}): number[] {
  const f = chunkFilter(scope, 'rowid');
  const rows = db
    .prepare(`SELECT rowid AS id FROM chunks_vec WHERE embedding MATCH @v AND k = @k${f.sql} ORDER BY distance`)
    .all({ v: toVecBlob(embedding), k: limit, ...f.params }) as { id: number }[];
  return rows.map((r) => r.id);
}

// Reciprocal rank fusion of keyword and vector results
export function fuse(rankings: number[][], limit: number): number[] {
  const score = new Map<number, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (RRF_K + i + 1)));
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
}

export function searchTranscript(db: DB, query: string, embedding: number[] | null, scope: EpisodeScope = {}, limit = 8): TranscriptHit[] {
  const terms = queryTerms(query);
  const rankings = [keywordRanking(db, terms, 30, scope)];
  if (embedding) rankings.push(vectorRanking(db, embedding, 30, scope));
  const ids = fuse(rankings, limit);
  if (!ids.length) return [];
  const rows = db
    .prepare(
      `SELECT c.id, e.episode_no, e.published_at, c.start_sec, c.text
       FROM chunks c JOIN episodes e ON e.id = c.episode_id
       WHERE e.status = 'done' AND c.id IN (${ids.map(() => '?').join(',')})`,
    )
    .all(...ids) as { id: number; episode_no: number; published_at: string; start_sec: number; text: string }[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids
    .map((id) => byId.get(id))
    .filter((r) => r !== undefined)
    .map((r) => ({ episodeNo: r.episode_no, publishedAt: r.published_at, startSec: r.start_sec, text: r.text }));
}

export type MentionQuery = EpisodeScope & { category: string | null; keyword: string | null; since: string | null };

// What a search looked for, for the status line on /ask and Telegram's ask:<id>. Logged
// calls from before episode / until existed lack them.
type Logged<T> = Partial<Record<keyof T, unknown>>;
const describeScope = (a: Logged<EpisodeScope>) =>
  [a.episode ? `EP${a.episode}` : null, a.since || a.until ? `${a.since ?? ''}～${a.until ?? ''}` : null];

export function describeMentionSearch(a: Logged<MentionQuery>): string {
  const [ep, range] = describeScope(a);
  return [ep, a.category, a.keyword, range].filter(Boolean).join('・') || '全部';
}

export function describeTranscriptSearch(a: Logged<EpisodeScope & { query: string }>): string {
  return [a.query, ...describeScope(a)].filter(Boolean).join('・');
}

export function searchMentions(db: DB, args: MentionQuery, limit = MENTION_LIMIT): MentionHit[] {
  const kw = args.keyword ? likePattern(args.keyword) : null;
  const { where, params } = scopeSql(args);
  const rows = db
    .prepare(
      `SELECT e.episode_no, e.published_at, m.start_sec, m.category, m.name, m.code, m.detail, m.quote
       FROM mentions m JOIN episodes e ON e.id = m.episode_id
       WHERE e.status = 'done'
         AND (@category IS NULL OR m.category = @category)
         AND (@kw IS NULL OR m.name LIKE @kw ESCAPE '\\' OR m.code LIKE @kw ESCAPE '\\'
              OR m.detail LIKE @kw ESCAPE '\\' OR m.quote LIKE @kw ESCAPE '\\')
         AND ${where}
       ORDER BY e.episode_no DESC, m.start_sec
       LIMIT @limit`,
    )
    .all({
      category: args.category,
      kw,
      ...params,
      limit,
    }) as {
    episode_no: number;
    published_at: string;
    start_sec: number;
    category: string;
    name: string;
    code: string | null;
    detail: string | null;
    quote: string | null;
  }[];
  return rows.map((r) => ({
    episodeNo: r.episode_no,
    publishedAt: r.published_at,
    startSec: r.start_sec,
    category: r.category,
    name: r.name,
    code: r.code,
    detail: r.detail,
    quote: r.quote,
  }));
}
