import type { DB } from './db.ts';
import { appendSegment } from './format.ts';
import { ftsPhrase, likePattern } from './fts.ts';
import { soundSearchable, toPinyin } from './pinyin.ts';
import { hasPinyin, SOUND_MATCH_LIMIT } from './ask/search.ts';
import type { Segment } from './segments.ts';
import { MAX_HIGHLIGHT_CHARS } from './transcript-focus.ts';
import { type SponsorIndex, sponsorHref } from './sponsors.ts';
import { searchKey, type StockIndex, stockHref, STOCKS_LABEL } from './stocks.ts';
import { type TopicIndex, topicHref } from './topics.ts';

// /search: every live episode whose transcript or summary has the words, free and without the
// model. Words are matched as written (trigram FTS for 3+ characters, LIKE below that, both
// ignoring case for Latin letters), a term of 3+ Chinese characters found nowhere is looked
// for by its sound (the speech-to-text writes names with other characters), and each episode
// shows the passages the words are in, timed to the segment, linking to that moment
// (/ep/<n>?t=&hl=, which opens the transcript searching for them). Nothing is logged.

export { SEARCH_MAX_CHARS } from './search-limits.ts';
import { SEARCH_MAX_CHARS } from './search-limits.ts';
export const SEARCH_MAX_TERMS = 5;
// One character matches nearly every episode (美 is in all 714)
export const MIN_TERM_CHARS = 2;
export const SEARCH_PER_PAGE = 20;
// Passages shown per episode; the rest are a link into the transcript
export const SNIPPETS_SHOWN = 3;
// A word said again within this of the last time is the same passage: a ten-minute talk
// about 台積電 is one passage, not twenty
export const SNIPPET_GAP_SEC = 30;
// Characters shown on each side of the words
const CONTEXT_CHARS = 40;

export type SearchSort = 'relevance' | 'new';

export type Query = {
  // The query as it is searched: trimmed, cut to SEARCH_MAX_CHARS
  q: string;
  terms: string[];
  // Terms left out: under MIN_TERM_CHARS, or past SEARCH_MAX_TERMS
  short: string[];
  extra: string[];
};

const chars = (s: string) => [...s].length;

export function parseQuery(raw: string | string[] | undefined): Query {
  const text = (typeof raw === 'string' ? raw : '').replace(/\s+/g, ' ').trim();
  const q = [...text].slice(0, SEARCH_MAX_CHARS).join('').trim();
  const seen = new Set<string>();
  const all: string[] = [];
  for (const t of q.split(' ')) {
    const k = t.toLowerCase();
    if (t && !seen.has(k)) {
      seen.add(k);
      all.push(t);
    }
  }
  const short = all.filter((t) => chars(t) < MIN_TERM_CHARS);
  const long = all.filter((t) => chars(t) >= MIN_TERM_CHARS);
  return { q, terms: long.slice(0, SEARCH_MAX_TERMS), short, extra: long.slice(SEARCH_MAX_TERMS) };
}

// One episode in the ranking, before its passages are read
type Found = {
  id: number;
  no: number;
  publishedAt: string;
  // Terms its summary points have
  summary: number;
  // Chunks with a term, over all the terms (a chunk with two counts twice)
  chunks: number;
  // Each sound term's chunks in it, to find the passages in
  soundChunks: { term: string; ids: number[] }[];
};

// Per episode: its number, date and matching chunks (and their ids for a term found by sound,
// at most SOUND_MATCH_LIMIT, to find its passages in)
type TermHits = { byEpisode: Map<number, { no: number; publishedAt: string; chunks: number; ids: number[] }>; summary: Set<number>; sound: boolean };

function hasTable(db: DB, name: string): boolean {
  return db.prepare(`SELECT 1 FROM sqlite_master WHERE name = ?`).get(name) !== undefined;
}

// The Q&A's keyword search (ask/search.ts) wants a term's first chunks, newest first, under a
// limit it tells the model about; this wants every episode with the term and how many of its
// chunks have it, so the counts are taken per episode in SQLite, with no limit to fall past
// (a two-character term over all 21k chunks: about 35 ms). The sound fallback is the Q&A's.
function termHits(db: DB, term: string, points: boolean): TermHits {
  const perEpisode = (from: string, q: string) =>
    db
      .prepare(
        `SELECT e.id, e.episode_no AS no, e.published_at AS publishedAt, COUNT(*) AS chunks FROM ${from}
         AND e.status = 'done' GROUP BY e.id`,
      )
      .all(q) as { id: number; no: number; publishedAt: string; chunks: number }[];
  const counts =
    chars(term) < 3
      ? perEpisode(`chunks c JOIN episodes e ON e.id = c.episode_id WHERE c.text LIKE ? ESCAPE '\\'`, likePattern(term))
      : perEpisode(`chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid JOIN episodes e ON e.id = c.episode_id WHERE chunks_fts MATCH ?`, ftsPhrase(term));
  const byEpisode: TermHits['byEpisode'] = new Map(counts.map((r) => [r.id, { no: r.no, publishedAt: r.publishedAt, chunks: r.chunks, ids: [] }]));
  const summary = new Set<number>(
    points
      ? (
          db
            .prepare(`SELECT DISTINCT p.episode_id AS id FROM summary_points p JOIN episodes e ON e.id = p.episode_id WHERE e.status = 'done' AND p.text LIKE ? ESCAPE '\\'`)
            .all(likePattern(term)) as { id: number }[]
        ).map((r) => r.id)
      : [],
  );
  // As the Q&A does: only when the words are nowhere, and not when the sound is common
  if (byEpisode.size || summary.size || !soundSearchable(term) || !hasPinyin(db)) return { byEpisode, summary, sound: false };
  const heard = db
    .prepare(
      `SELECT c.id, e.id AS episode_id, e.episode_no AS no, e.published_at AS publishedAt FROM chunks_pinyin JOIN chunks c ON c.id = chunks_pinyin.rowid
       JOIN episodes e ON e.id = c.episode_id WHERE chunks_pinyin MATCH ? AND e.status = 'done' ORDER BY e.episode_no DESC, c.id LIMIT ${SOUND_MATCH_LIMIT + 1}`,
    )
    .all(ftsPhrase(toPinyin(term))) as { id: number; episode_id: number; no: number; publishedAt: string }[];
  if (!heard.length || heard.length > SOUND_MATCH_LIMIT) return { byEpisode, summary, sound: false };
  for (const r of heard) {
    const e = byEpisode.get(r.episode_id) ?? { no: r.no, publishedAt: r.publishedAt, chunks: 0, ids: [] };
    e.chunks++;
    e.ids.push(r.id);
    byEpisode.set(r.episode_id, e);
  }
  return { byEpisode, summary, sound: true };
}

// The episodes with every term, in the order shown: relevance puts the ones whose summary has
// more of the terms first (the episode is about it, not a word in passing), then more chunks,
// then the newer; `new` is by date.
function findEpisodes(db: DB, terms: string[], sort: SearchSort): { found: Found[]; soundTerms: string[] } {
  const points = hasTable(db, 'summary_points');
  const hits = terms.map((t) => termHits(db, t, points));
  const meta = new Map<number, { no: number; publishedAt: string }>();
  for (const h of hits) for (const [id, e] of h.byEpisode) meta.set(id, e);
  // A summary-only episode needs its number and date too
  const summaryOnly = [...new Set(hits.flatMap((h) => [...h.summary]))].filter((id) => !meta.has(id));
  if (summaryOnly.length) {
    const rows = db
      .prepare(`SELECT id, episode_no AS no, published_at AS publishedAt FROM episodes WHERE id IN (SELECT value FROM json_each(?))`)
      .all(JSON.stringify(summaryOnly)) as { id: number; no: number; publishedAt: string }[];
    for (const r of rows) meta.set(r.id, r);
  }
  const found: Found[] = [];
  for (const [id, m] of meta) {
    if (!hits.every((h) => h.byEpisode.has(id) || h.summary.has(id))) continue;
    found.push({
      id,
      ...m,
      summary: hits.filter((h) => h.summary.has(id)).length,
      chunks: hits.reduce((n, h) => n + (h.byEpisode.get(id)?.chunks ?? 0), 0),
      soundChunks: hits.flatMap((h, i) => (h.sound && h.byEpisode.has(id) ? [{ term: terms[i]!, ids: h.byEpisode.get(id)!.ids }] : [])),
    });
  }
  const newer = (a: Found, b: Found) => b.publishedAt.localeCompare(a.publishedAt) || b.no - a.no;
  found.sort(sort === 'new' ? newer : (a, b) => b.summary - a.summary || b.chunks - a.chunks || newer(a, b));
  return { found, soundTerms: terms.filter((_, i) => hits[i]!.sound) };
}

export type SnippetPart = { text: string; mark: boolean };
export type Snippet = { t: number; hl: string; parts: SnippetPart[] };
export type SearchEpisode = {
  no: number;
  title: string;
  publishedAt: string;
  line: string;
  // A summary point with a term (the episode is about it): around its first term, marked
  point: { t: number; parts: SnippetPart[] } | null;
  snippets: Snippet[];
  // Passages past the ones shown (SNIPPET_GAP_SEC apart), and where the first of them is
  more: { count: number; t: number; hl: string } | null;
};
export type SearchResult = { total: number; page: number; pages: number; episodes: SearchEpisode[]; soundTerms: string[] };

// The transcript as one text the way chunks join it (chunk.ts joinSegments), with where each
// segment starts in it
function joined(segments: Segment[]): { text: string; starts: number[] } {
  let text = '';
  const starts: number[] = [];
  for (const s of segments) {
    text = appendSegment(text, s.text);
    starts.push(text.length - s.text.length);
  }
  return { text, starts };
}

// The segment an offset of the joined text is in
function segmentAt(starts: number[], at: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= at) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

type Match = { at: number; len: number; seg: number };

// Every place a term is written, ignoring case (as FTS and LIKE did), at its offsets in the text
// itself: a lowercased copy can differ in length (İ)
const escapeRegExp = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function writtenMatches(text: string, starts: number[], term: string): Match[] {
  const out: Match[] = [];
  for (const m of text.matchAll(new RegExp(escapeRegExp(term), 'giu'))) out.push({ at: m.index, len: m[0].length, seg: segmentAt(starts, m.index) });
  return out;
}

// Where a term found by sound is in the chunks that matched: the run of characters that reads
// the same, every one in the segment. pinyin-pro reads a character with several sounds from its
// context, which a few characters alone may not give, so a segment that reads the same as a
// whole is marked whole, and a chunk with neither (the index read it across segments) still
// gets its start, unmarked: the episode is listed, so it shows where.
function soundMatches(segments: Segment[], starts: number[], chunkStarts: number[], term: string): Match[] {
  const target = toPinyin(term);
  const n = chars(term);
  const out: Match[] = [];
  const read = new Set<number>();
  const unmarked = new Set<number>();
  for (const from of chunkStarts) {
    const first = segments.findIndex((s) => s.start >= from);
    if (first < 0) continue;
    let found = false;
    // A chunk is about 600 characters from the segment it starts at
    for (let i = first, len = 0; i < segments.length && len < 700; len += segments[i]!.text.length, i++) {
      if (read.has(i)) continue;
      read.add(i);
      const seg = segments[i]!.text;
      if (!toPinyin(seg).includes(target)) continue;
      found = true;
      const cs = [...seg];
      let marked = false;
      for (let k = 0, at = 0; k + n <= cs.length; at += cs[k]!.length, k++) {
        const w = cs.slice(k, k + n).join('');
        if (toPinyin(w) === target) {
          out.push({ at: starts[i]! + at, len: w.length, seg: i });
          marked = true;
        }
      }
      if (!marked) out.push({ at: starts[i]!, len: seg.length, seg: i });
    }
    if (!found && !unmarked.has(first)) {
      unmarked.add(first);
      out.push({ at: starts[first]!, len: 0, seg: first });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// The text around one match, every match inside it marked, '…' where it was cut
function excerpt(text: string, matches: Match[], m: Match): SnippetPart[] {
  let from = Math.max(0, m.at - CONTEXT_CHARS);
  let to = Math.min(text.length, m.at + m.len + CONTEXT_CHARS);
  // Not in the middle of a surrogate pair
  if (from > 0 && /[\uDC00-\uDFFF]/.test(text[from]!)) from--;
  if (to < text.length && /[\uDC00-\uDFFF]/.test(text[to]!)) to++;
  const parts: SnippetPart[] = [];
  let at = from;
  for (const x of matches) {
    if (!x.len || x.at < at || x.at + x.len > to) continue;
    if (x.at > at) parts.push({ text: text.slice(at, x.at), mark: false });
    parts.push({ text: text.slice(x.at, x.at + x.len), mark: true });
    at = x.at + x.len;
  }
  if (at < to) parts.push({ text: text.slice(at, to), mark: false });
  if (from > 0) parts.unshift({ text: '…', mark: false });
  if (to < text.length) parts.push({ text: '…', mark: false });
  return parts;
}

function snippet(text: string, matches: Match[], m: Match, segments: Segment[]): Snippet {
  const words = text.slice(m.at, m.at + m.len);
  return { t: Math.floor(segments[m.seg]!.start), hl: [...words].slice(0, MAX_HIGHLIGHT_CHARS).join(''), parts: excerpt(text, matches, m) };
}

// A summary point as shown: around the first term in it
function pointParts(text: string, terms: string[]): SnippetPart[] {
  const matches = terms.flatMap((t) => writtenMatches(text, [0], t)).sort((a, b) => a.at - b.at);
  return matches.length ? excerpt(text, matches, matches[0]!) : [{ text, mark: false }];
}

// One page of results: the ranking over every live episode, then the transcripts of the page's
// episodes only, read for their passages
export function siteSearch(db: DB, terms: string[], sort: SearchSort = 'relevance', page = 1): SearchResult {
  if (!terms.length) return { total: 0, page: 1, pages: 1, episodes: [], soundTerms: [] };
  const { found, soundTerms } = findEpisodes(db, terms, sort);
  const pages = Math.max(1, Math.ceil(found.length / SEARCH_PER_PAGE));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const shown = found.slice((p - 1) * SEARCH_PER_PAGE, p * SEARCH_PER_PAGE);
  if (!shown.length) return { total: found.length, page: p, pages, episodes: [], soundTerms };

  const rows = db
    .prepare(
      `SELECT id, episode_no, title, published_at, segments_json, json_extract(summary_json, '$.line') AS line
       FROM episodes WHERE id IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify(shown.map((f) => f.id))) as { id: number; episode_no: number; title: string; published_at: string; segments_json: string | null; line: string | null }[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const written = terms.filter((t) => !soundTerms.includes(t));
  const pointOf = hasTable(db, 'summary_points')
    ? db.prepare(
        `SELECT start_sec AS t, text FROM summary_points WHERE episode_id = ? AND (${written.map(() => `text LIKE ? ESCAPE '\\'`).join(' OR ') || '0'}) ORDER BY start_sec, id LIMIT 1`,
      )
    : null;
  const chunkStarts = db.prepare(`SELECT start_sec AS t FROM chunks WHERE id IN (SELECT value FROM json_each(?)) ORDER BY start_sec`);

  const episodes = shown.map((f): SearchEpisode => {
    const r = byId.get(f.id)!;
    const segments = r.segments_json ? (JSON.parse(r.segments_json) as Segment[]) : [];
    const { text, starts } = joined(segments);
    const matches = [
      ...written.flatMap((t) => writtenMatches(text, starts, t)),
      ...f.soundChunks.flatMap(({ term, ids }) =>
        soundMatches(segments, starts, (chunkStarts.all(JSON.stringify(ids)) as { t: number }[]).map((c) => c.t), term),
      ),
    ].sort((a, b) => a.at - b.at);
    // Passages: runs of matches each within SNIPPET_GAP_SEC of the one before, shown by their first
    const passages: Match[] = [];
    let prev: Match | undefined;
    for (const m of matches) {
      if (!prev || segments[m.seg]!.start - segments[prev.seg]!.start >= SNIPPET_GAP_SEC) passages.push(m);
      prev = m;
    }
    const snippets = passages.slice(0, SNIPPETS_SHOWN).map((m) => snippet(text, matches, m, segments));
    const rest = passages.slice(SNIPPETS_SHOWN);
    const row = f.summary && pointOf ? (pointOf.get(f.id, ...written.map(likePattern)) as { t: number; text: string } | undefined) : undefined;
    const point = row ? { t: row.t, parts: pointParts(row.text, written) } : null;
    return {
      no: r.episode_no,
      title: r.title,
      publishedAt: r.published_at,
      line: r.line ?? '',
      point,
      snippets,
      more: rest.length ? { count: rest.length, t: Math.floor(segments[rest[0]!.seg]!.start), hl: snippet(text, matches, rest[0]!, segments).hl } : null,
    };
  });
  return { total: found.length, page: p, pages, episodes, soundTerms };
}

// Pages named by the query (a stock, a topic, a sponsor): the ones whose name, code or other
// name is the query first, then the ones containing it, by how many episodes, at most
// RELATED_MAX. Only from MIN_TERM_CHARS on, like the terms.
export const RELATED_MAX = 6;
export type RelatedPage = { kind: string; name: string; href: string; episodes: number };

export function relatedPages(pages: { index: StockIndex; topics: TopicIndex; sponsors: SponsorIndex }, q: string): RelatedPage[] {
  const key = searchKey(q);
  if (chars(key) < MIN_TERM_CHARS) return [];
  const found: (RelatedPage & { exact: boolean })[] = [];
  const add = (names: string[], page: RelatedPage) => {
    const keys = names.map(searchKey).filter(Boolean);
    const exact = keys.includes(key);
    if (exact || keys.some((k) => k.includes(key))) found.push({ ...page, exact });
  };
  for (const s of new Set(pages.index.byKey.values()))
    add([s.name, s.code ?? '', s.slug, ...s.aliases], { kind: STOCKS_LABEL, name: s.name, href: stockHref(s), episodes: s.episodes.length });
  for (const items of pages.topics.values())
    for (const t of items.values()) add([t.name], { kind: t.category.label, name: t.name, href: topicHref(t), episodes: t.episodes.length });
  for (const s of pages.sponsors.bySlug.values()) add([s.name], { kind: '業配', name: s.name, href: sponsorHref(s), episodes: s.episodes.length });
  return found
    .sort((a, b) => Number(b.exact) - Number(a.exact) || b.episodes - a.episodes)
    .slice(0, RELATED_MAX)
    .map(({ exact: _, ...p }) => p);
}
