// --retrieval-only: calls the search functions with each question's own `queries`, with
// no model and no API call. Keyword search only (no embeddings), so it shows what a
// change to search.ts does to the keyword half and to mentions.
//
// It also looks past the search limits, for what the golden set's rules ask after a
// backfill: which other episodes now match a question's queries (a second right answer,
// or a not_found question that has one now), and which terms match more rows than a
// search reads.
import { createHash } from 'node:crypto';
import { likePattern, MENTION_LIMIT, queryTerms, searchMentions, searchTranscript, TERM_MATCH_LIMIT } from '../../src/lib/ask/search.ts';
import type { DB } from '../../src/lib/db.ts';
import { type GoldenQuestion, needed, type QuestionType } from './golden.ts';
import type { DbInfo } from './score.ts';

export type TermLoad = { term: string; chunks: number; mentions: number };

export type RetrievalResult = {
  id: string;
  type: QuestionType;
  hash: string; // of what this check reads from the question
  ok: boolean | null; // null = no expected episodes
  found: number[]; // expected episodes the searches returned
  transcriptEps: number[];
  mentionEps: number[];
  others: number[]; // episodes outside expect_eps that match a whole query
  overLimit: TermLoad[]; // terms with more matches than one search reads
};

const sorted = (xs: Iterable<number>) => [...new Set(xs)].sort((a, b) => a - b);

const MENTION_MATCH = `(m.name LIKE @p ESCAPE '\\' OR m.code LIKE @p ESCAPE '\\' OR m.detail LIKE @p ESCAPE '\\' OR m.quote LIKE @p ESCAPE '\\')`;

export function retrievalCheck(db: DB, q: GoldenQuestion): RetrievalResult {
  const transcript = new Set<number>();
  const mentions = new Set<number>();
  const others = new Set<number>();
  const loads = new Map<string, TermLoad>();

  for (const query of q.queries) {
    for (const h of searchTranscript(db, query, null)) transcript.add(h.episodeNo);
    const terms = queryTerms(query);
    for (const term of terms) if (!loads.has(term)) loads.set(term, termLoad(db, term));
    for (const ep of episodesMatchingAll(db, terms)) others.add(ep);
    // search_mentions takes one keyword, so only a one-word query (a name) is looked up
    // there. Searching each word of a longer query would find an episode through any
    // mention that happens to hold one common word.
    if (terms.length === 1) {
      for (const h of searchMentions(db, { category: null, keyword: terms[0]!, since: null })) mentions.add(h.episodeNo);
      for (const ep of mentionEpisodes(db, terms[0]!)) others.add(ep);
    }
  }

  const all = new Set([...transcript, ...mentions]);
  const found = q.expect_eps.filter((e) => all.has(e));
  return {
    id: q.id,
    type: q.type,
    hash: createHash('sha256').update(JSON.stringify([q.queries, q.expect_eps, q.min_eps ?? null])).digest('hex').slice(0, 12),
    ok: q.expect_eps.length ? found.length >= needed(q) : null,
    found,
    transcriptEps: sorted(transcript),
    mentionEps: sorted(mentions),
    others: sorted(others).filter((e) => !q.expect_eps.includes(e)),
    overLimit: [...loads.values()].filter((l) => l.chunks > TERM_MATCH_LIMIT || l.mentions > MENTION_LIMIT),
  };
}

function termLoad(db: DB, term: string): TermLoad {
  const p = likePattern(term);
  const chunks = db
    .prepare(`SELECT COUNT(*) AS n FROM chunks c JOIN episodes e ON e.id = c.episode_id WHERE e.status = 'done' AND c.text LIKE ? ESCAPE '\\'`)
    .get(p) as { n: number };
  const mentions = db
    .prepare(`SELECT COUNT(*) AS n FROM mentions m JOIN episodes e ON e.id = m.episode_id WHERE e.status = 'done' AND ${MENTION_MATCH}`)
    .get({ p }) as { n: number };
  return { term, chunks: chunks.n, mentions: mentions.n };
}

// Episodes with a chunk that contains every term, however many chunks match
function episodesMatchingAll(db: DB, terms: string[]): number[] {
  if (!terms.length) return [];
  const rows = db
    .prepare(
      `SELECT DISTINCT e.episode_no AS ep FROM chunks c JOIN episodes e ON e.id = c.episode_id
       WHERE e.status = 'done' AND ${terms.map(() => `c.text LIKE ? ESCAPE '\\'`).join(' AND ')}`,
    )
    .all(...terms.map(likePattern)) as { ep: number }[];
  return rows.map((r) => r.ep);
}

function mentionEpisodes(db: DB, term: string): number[] {
  const rows = db
    .prepare(`SELECT DISTINCT e.episode_no AS ep FROM mentions m JOIN episodes e ON e.id = m.episode_id WHERE e.status = 'done' AND ${MENTION_MATCH}`)
    .all({ p: likePattern(term) }) as { ep: number }[];
  return rows.map((r) => r.ep);
}

export type RetrievalRun = {
  meta: { startedAt: string; sha: string; db: DbInfo; partial: boolean };
  questions: RetrievalResult[];
};

export type RetrievalDiff = {
  lost: string[]; // found before, not now
  gained: string[];
  newOthers: { id: string; eps: number[] }[]; // episodes that newly match a question's queries
  rewritten: string[]; // queries or expected episodes were edited, so not compared
};

export function compareRetrieval(before: RetrievalRun, after: RetrievalRun): RetrievalDiff {
  const old = new Map(before.questions.map((q) => [q.id, q]));
  const d: RetrievalDiff = { lost: [], gained: [], newOthers: [], rewritten: [] };
  for (const q of after.questions) {
    const o = old.get(q.id);
    if (!o) continue;
    if (o.hash !== q.hash) {
      d.rewritten.push(q.id);
      continue;
    }
    if (o.ok === true && q.ok === false) d.lost.push(q.id);
    if (o.ok === false && q.ok === true) d.gained.push(q.id);
    // Safety questions search for everyday words (台積電, 台股) that every episode has
    if (q.type === 'safety') continue;
    const eps = q.others.filter((e) => !o.others.includes(e));
    if (eps.length) d.newOthers.push({ id: q.id, eps });
  }
  return d;
}
