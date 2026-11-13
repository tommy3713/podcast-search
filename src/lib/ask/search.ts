import type { DB } from '../db.ts';
import { soundSearchable, toPinyin } from '../pinyin.ts';
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
// A term found by sound in more chunks than this is a common sound, not a misheard name
export const SOUND_MATCH_LIMIT = 50;

// Words in the model's query. Trigram FTS needs 3+ characters, so shorter terms such as
// 苗栗 fall back to LIKE; with a few thousand chunks a scan takes milliseconds.
export function queryTerms(query: string): string[] {
  return [...new Set(query.split(/[\s,，、]+/).map((t) => t.trim()).filter(Boolean))].slice(0, MAX_TERMS);
}

const ftsPhrase = (term: string) => `"${term.replace(/"/g, '""')}"`;
export const likePattern = (term: string) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

// One episode or a range of Taipei days (both ends included), for either search
export type EpisodeScope = { episode?: number | null; since?: string | null; until?: string | null };

export const hasScope = (s: EpisodeScope) => Boolean(s.episode || s.since || s.until);

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

// Ids of the live episodes in a scope, or null without one. An empty list means the scope
// holds no episode in the database (not backfilled, a gap, or an episode outside the dates),
// which the caller must not report as "never said".
export function episodesInScope(db: DB, scope: EpisodeScope): number[] | null {
  if (!hasScope(scope)) return null;
  const { where, params } = scopeSql(scope);
  const rows = db.prepare(`SELECT e.id FROM episodes e WHERE e.status = 'done' AND ${where}`).all(params) as { id: number }[];
  return rows.map((r) => r.id);
}

// ` AND <col> IN (rows of `table` from these episodes)`, or nothing without a scope. It
// sits inside each ranking's query, so the read limits apply within the scope rather than
// cutting it off.
function scopeFilter(episodeIds: number[] | null, col = 'rowid', table: 'chunks' | 'summary_points' = 'chunks') {
  if (!episodeIds) return { sql: '', params: {} };
  return {
    sql: ` AND ${col} IN (SELECT id FROM ${table} WHERE episode_id IN (SELECT value FROM json_each(@episodeIds)))`,
    params: { episodeIds: JSON.stringify(episodeIds) },
  };
}

// chunks_pinyin came with a migration; a snapshot from before it searches without sound.
// Only a yes is kept: a long-lived connection (npm run dev) sees the table once a local
// migrate or index-pinyin adds it.
const pinyinTable = new WeakSet<DB>();
export function hasPinyin(db: DB): boolean {
  if (pinyinTable.has(db)) return true;
  const has = db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'chunks_pinyin'`).get() !== undefined;
  if (has) pinyinTable.add(db);
  return has;
}

// Live chunks the pinyin index lacks (published before it, or by the previous release
// during a deploy): the worker fills them at startup. Null without the table.
export function chunksMissingPinyin(db: DB): number | null {
  if (!hasPinyin(db)) return null;
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM chunks c JOIN episodes e ON e.id = c.episode_id
         WHERE e.status = 'done' AND NOT EXISTS (SELECT 1 FROM chunks_pinyin p WHERE p.rowid = c.id)`,
      )
      .get() as { n: number }
  ).n;
}

// Chunk ids ranked by how many query terms they contain, the terms that matched more
// chunks than one read takes, the terms found only by their sound, and whether any term
// matched as written. Each read takes the chunks of the newest episodes (chunk ids follow
// insertion order, and backfill inserts older episodes last), and ties go the same way:
// newer episode first, then earlier in the episode.
// A term of 3+ Chinese characters that no chunk of the scope has is looked for by its
// pinyin: the speech-to-text often writes a name with other characters that sound the
// same (椒鹽肥腸 as 交言肥腸), which neither the keyword nor the vector rankings find.
// Only then: a term written right somewhere skips it, even if other episodes misheard it.
function keywordRanking(
  db: DB,
  terms: string[],
  limit: number,
  episodeIds: number[] | null,
): { ids: number[]; cutTerms: string[]; sound: { term: string; ids: number[] }[]; matched: boolean } {
  const f = scopeFilter(episodeIds, 'c.id');
  // One row past the limit tells a term that was cut from one that just fills it
  const newestFirst = `AND e.status = 'done'${f.sql} ORDER BY e.episode_no DESC, c.id LIMIT ${TERM_MATCH_LIMIT + 1}`;
  const fts = db.prepare(
    `SELECT c.id, e.episode_no AS ep FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid JOIN episodes e ON e.id = c.episode_id
     WHERE chunks_fts MATCH @q ${newestFirst}`,
  );
  const like = db.prepare(
    `SELECT c.id, e.episode_no AS ep FROM chunks c JOIN episodes e ON e.id = c.episode_id
     WHERE c.text LIKE @q ESCAPE '\\' ${newestFirst}`,
  );
  // The phrase matches whole syllables in order, and unicode61 drops the punctuation
  const sound = hasPinyin(db)
    ? db.prepare(
        `SELECT c.id, e.episode_no AS ep FROM chunks_pinyin JOIN chunks c ON c.id = chunks_pinyin.rowid JOIN episodes e ON e.id = c.episode_id
         WHERE chunks_pinyin MATCH @q AND e.status = 'done'${f.sql} ORDER BY e.episode_no DESC, c.id LIMIT ${SOUND_MATCH_LIMIT + 1}`,
      )
    : null;
  const matches = new Map<number, { n: number; ep: number }>();
  const cutTerms: string[] = [];
  const soundFound: { term: string; ids: number[] }[] = [];
  // Whether a term was found as written. Sound matches don't count: the passages they bring
  // may not make it into the hits, and then the model must still be told it's nowhere.
  let written = false;
  for (const term of terms) {
    const short = [...term].length < 3;
    let rows = (short ? like : fts).all({ q: short ? likePattern(term) : ftsPhrase(term), ...f.params }) as { id: number; ep: number }[];
    if (rows.length > TERM_MATCH_LIMIT) {
      cutTerms.push(term);
      rows = rows.slice(0, TERM_MATCH_LIMIT);
    }
    if (rows.length) written = true;
    else if (sound && soundSearchable(term)) {
      const heard = sound.all({ q: ftsPhrase(toPinyin(term)), ...f.params }) as { id: number; ep: number }[];
      if (heard.length && heard.length <= SOUND_MATCH_LIMIT) {
        soundFound.push({ term, ids: heard.map((r) => r.id) });
        rows = heard;
      }
    }
    for (const r of rows) matches.set(r.id, { n: (matches.get(r.id)?.n ?? 0) + 1, ep: r.ep });
  }
  const ids = [...matches.entries()]
    .sort(([ia, a], [ib, b]) => b.n - a.n || b.ep - a.ep || ia - ib)
    .slice(0, limit)
    .map(([id]) => id);
  return { ids, cutTerms, sound: soundFound, matched: written };
}

// sqlite-vec (0.1.9) takes a rowid IN filter inside the KNN query itself
function vectorRanking(db: DB, embedding: number[], limit: number, episodeIds: number[] | null): number[] {
  const f = scopeFilter(episodeIds);
  const rows = db
    .prepare(`SELECT rowid AS id FROM chunks_vec WHERE embedding MATCH @v AND k = @k${f.sql} ORDER BY distance`)
    .all({ v: toVecBlob(embedding), k: limit, ...f.params }) as { id: number }[];
  return rows.map((r) => r.id);
}

// How many summary points one search takes. Each brings the one chunk of its chapter
// nearest the query: on the golden set (62 episodes, vectors of the question text) 2 or 3
// per point, or 20 points, found fewer of the expected episodes, by crowding out the other
// rankings' hits.
const SUMMARY_POINT_LIMIT = 10;

// Chunks found through the summary: the points nearest the query, each replaced by the
// chunk of its chapter nearest the query. The summary is written language (群組, 推薦)
// where the transcript is speech-to-text of spoken language (推標的, misheard names), and a
// point is about one thing where a chunk is mostly small talk, so a question can match a
// chapter whose chunks it doesn't. Only chunks come out: the model reads and cites what was
// said, never the summary.
function summaryRanking(db: DB, embedding: number[], episodeIds: number[] | null): number[] {
  // A snapshot from before summary points (local tools open it readonly, so unmigrated)
  // searches without them; live, the migration runs before the web is replaced
  if (!db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'summary_points_vec'`).get()) return [];
  const v = toVecBlob(embedding);
  const scoped = scopeFilter(episodeIds, 'rowid', 'summary_points');
  const points = db
    .prepare(
      `SELECT p.episode_id, p.start_sec, p.end_sec
       FROM (SELECT rowid AS id, distance FROM summary_points_vec WHERE embedding MATCH @v AND k = @k${scoped.sql}) n
       JOIN summary_points p ON p.id = n.id ORDER BY n.distance`,
    )
    .all({ v, k: SUMMARY_POINT_LIMIT, ...scoped.params }) as { episode_id: number; start_sec: number; end_sec: number | null }[];
  if (!points.length) return [];

  // The chunks each point's chapter spans: from the one it starts in to the last that
  // starts before the next chapter
  const chunksOf = db.prepare('SELECT id, start_sec FROM chunks WHERE episode_id = ? ORDER BY start_sec, idx');
  const byEpisode = new Map<number, { id: number; start_sec: number }[]>();
  const spans = points.map((p) => {
    let chunks = byEpisode.get(p.episode_id);
    if (!chunks) byEpisode.set(p.episode_id, (chunks = chunksOf.all(p.episode_id) as { id: number; start_sec: number }[]));
    const first = Math.max(0, chunks.findLastIndex((c) => c.start_sec <= p.start_sec));
    return chunks.slice(first).filter((c, i) => i === 0 || p.end_sec === null || c.start_sec < p.end_sec).map((c) => c.id);
  });

  // The distance of every chunk in those spans (lookups by rowid, not a second KNN; L2,
  // like the KNN's), to pick each span's nearest
  const candidates = [...new Set(spans.flat())];
  if (!candidates.length) return [];
  const rows = db
    .prepare(`SELECT rowid AS id, vec_distance_l2(embedding, @v) AS d FROM chunks_vec WHERE rowid IN (SELECT value FROM json_each(@ids))`)
    .all({ v, ids: JSON.stringify(candidates) }) as { id: number; d: number }[];
  const dist = new Map(rows.map((r) => [r.id, r.d]));
  const ids: number[] = [];
  for (const span of spans) {
    let best: number | undefined;
    for (const id of span) if (dist.has(id) && (best === undefined || dist.get(id)! < dist.get(best)!)) best = id;
    if (best !== undefined && !ids.includes(best)) ids.push(best);
  }
  return ids;
}

// Reciprocal rank fusion of keyword and vector results
export function fuse(rankings: number[][], limit: number): number[] {
  const score = new Map<number, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (RRF_K + i + 1)));
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
}

// Whether any term is in a summary point or a mention of the scope's live episodes. Both
// are written from the transcript with names corrected, so a name the transcript has
// misheard (Groq written as Grok) is often there.
function inSummariesOrMentions(db: DB, terms: string[], episodeIds: number[] | null): boolean {
  const scoped = episodeIds ? 'AND e.id IN (SELECT value FROM json_each(@episodeIds))' : '';
  const params = episodeIds ? { episodeIds: JSON.stringify(episodeIds) } : {};
  const point = db.prepare(
    `SELECT 1 FROM summary_points p JOIN episodes e ON e.id = p.episode_id
     WHERE e.status = 'done' ${scoped} AND p.text LIKE @kw ESCAPE '\\' LIMIT 1`,
  );
  const mention = db.prepare(
    `SELECT 1 FROM mentions m JOIN episodes e ON e.id = m.episode_id
     WHERE e.status = 'done' ${scoped}
       AND (m.name LIKE @kw ESCAPE '\\' OR m.code LIKE @kw ESCAPE '\\' OR m.detail LIKE @kw ESCAPE '\\' OR m.quote LIKE @kw ESCAPE '\\')
     LIMIT 1`,
  );
  return terms.some((t) => {
    const p = { kw: likePattern(t), ...params };
    return point.get(p) !== undefined || mention.get(p) !== undefined;
  });
}

// `terms`: the words searched (queryTerms). `cutTerms`: terms with more matching chunks
// than keyword search reads, so the model can be told the results may miss episodes.
// `unmatched`: no term is in any transcript, summary point or mention of the scope, so
// every hit came from the meaning-based rankings, which always return their nearest
// chunks: asked about Rivian, which no episode names, they brought EP706's Tesla Roadster,
// and the model answered with it as if it were Rivian.
// `soundTerms`: terms no chunk has, found by their pinyin instead (keywordRanking), and
// only those with a chunk among the hits, so the model isn't told of passages it can't see.
export type TranscriptResult = { hits: TranscriptHit[]; terms: string[]; cutTerms: string[]; soundTerms: string[]; unmatched: boolean };

export function searchTranscript(db: DB, query: string, embedding: number[] | null, scope: EpisodeScope = {}, limit = 8): TranscriptResult {
  const terms = queryTerms(query);
  const episodeIds = episodesInScope(db, scope);
  if (episodeIds?.length === 0) return { hits: [], terms, cutTerms: [], soundTerms: [], unmatched: false };
  const keyword = keywordRanking(db, terms, 30, episodeIds);
  const rankings = [keyword.ids];
  if (embedding) rankings.push(vectorRanking(db, embedding, 30, episodeIds), summaryRanking(db, embedding, episodeIds));
  const ids = fuse(rankings, limit);
  const notWritten = terms.length > 0 && !keyword.matched && !inSummariesOrMentions(db, terms, episodeIds);
  if (!ids.length) return { hits: [], terms, cutTerms: keyword.cutTerms, soundTerms: [], unmatched: notWritten };
  const rows = db
    .prepare(
      `SELECT c.id, e.episode_no, e.published_at, c.start_sec, c.text
       FROM chunks c JOIN episodes e ON e.id = c.episode_id
       WHERE e.status = 'done' AND c.id IN (${ids.map(() => '?').join(',')})`,
    )
    .all(...ids) as { id: number; episode_no: number; published_at: string; start_sec: number; text: string }[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const hits = ids
    .map((id) => byId.get(id))
    .filter((r) => r !== undefined)
    .map((r) => ({ episodeNo: r.episode_no, publishedAt: r.published_at, startSec: r.start_sec, text: r.text }));
  const shown = new Set(ids.filter((id) => byId.has(id)));
  const soundTerms = keyword.sound.filter((s) => s.ids.some((id) => shown.has(id))).map((s) => s.term);
  // A passage found by sound among the hits gets its own note instead
  return { hits, terms, cutTerms: keyword.cutTerms, soundTerms, unmatched: notWritten && !soundTerms.length };
}

export type MentionQuery = EpisodeScope & { category: string | null; keyword: string | null };

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
  return [a.query, ...describeScope(a)].filter(Boolean).join('・') || JSON.stringify(a);
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
