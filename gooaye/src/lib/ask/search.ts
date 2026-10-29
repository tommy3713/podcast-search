import type { DB } from '../db.ts';
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

// Words in the model's query. Trigram FTS needs 3+ characters, so shorter terms such as
// 苗栗 fall back to LIKE; with a few thousand chunks a scan takes milliseconds.
export function queryTerms(query: string): string[] {
  return [...new Set(query.split(/[\s,，、]+/).map((t) => t.trim()).filter(Boolean))].slice(0, MAX_TERMS);
}

const ftsPhrase = (term: string) => `"${term.replace(/"/g, '""')}"`;
const likePattern = (term: string) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

// Chunk ids ranked by how many query terms they contain, newest episode first on ties
function keywordRanking(db: DB, terms: string[], limit: number): number[] {
  const matches = new Map<number, number>();
  const fts = db.prepare('SELECT rowid AS id FROM chunks_fts WHERE chunks_fts MATCH ? LIMIT 200');
  const like = db.prepare(`SELECT id FROM chunks WHERE text LIKE ? ESCAPE '\\' LIMIT 200`);
  for (const term of terms) {
    const rows = ([...term].length >= 3 ? fts.all(ftsPhrase(term)) : like.all(likePattern(term))) as { id: number }[];
    for (const r of rows) matches.set(r.id, (matches.get(r.id) ?? 0) + 1);
  }
  if (!matches.size) return [];
  // Higher chunk id = later insert ≈ newer episode
  return [...matches.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]).slice(0, limit).map(([id]) => id);
}

function vectorRanking(db: DB, embedding: number[], limit: number): number[] {
  const rows = db
    .prepare('SELECT rowid AS id FROM chunks_vec WHERE embedding MATCH ? AND k = ? ORDER BY distance')
    .all(toVecBlob(embedding), limit) as { id: number }[];
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

export function searchTranscript(db: DB, query: string, embedding: number[] | null, limit = 8): TranscriptHit[] {
  const terms = queryTerms(query);
  const rankings = [keywordRanking(db, terms, 30)];
  if (embedding) rankings.push(vectorRanking(db, embedding, 30));
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

export function searchMentions(
  db: DB,
  args: { category: string | null; keyword: string | null; since: string | null },
  limit = 30,
): MentionHit[] {
  const kw = args.keyword ? likePattern(args.keyword) : null;
  const rows = db
    .prepare(
      `SELECT e.episode_no, e.published_at, m.start_sec, m.category, m.name, m.code, m.detail, m.quote
       FROM mentions m JOIN episodes e ON e.id = m.episode_id
       WHERE e.status = 'done'
         AND (@category IS NULL OR m.category = @category)
         AND (@kw IS NULL OR m.name LIKE @kw ESCAPE '\\' OR m.code LIKE @kw ESCAPE '\\'
              OR m.detail LIKE @kw ESCAPE '\\' OR m.quote LIKE @kw ESCAPE '\\')
         AND (@since IS NULL OR e.published_at >= @since)
       ORDER BY e.episode_no DESC, m.start_sec
       LIMIT @limit`,
    )
    .all({ category: args.category, kw, since: args.since, limit }) as {
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
