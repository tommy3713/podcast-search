import { type DB, EMBEDDING_DIM, hasTable } from './db.ts';
import { readDb } from './server-db.ts';

// 內容相近的集數 under an episode: the live episodes whose summaries are nearest in meaning.
// Each episode is the mean of its summary points' vectors (each non-ad chapter and each key
// point, already embedded for the Q&A's summary ranking), so nothing is paid for here. Tried
// against shared mentions weighted by rarity, which matched EP712 (a crash) with episodes that
// only shared YouTube Premium and 0050; the vectors matched it with other crash episodes.
// Nearness says what an episode talks about, never what the host thought of it.
export const RELATED_COUNT = 4;
// Episodes further below the nearest one than this are left out. Over the 714 episodes the
// 4th nearest is at most 0.029 below the nearest for 95% of them, so this only trims the few
// whose list falls off (up to 0.11 below).
export const RELATED_MAX_DROP = 0.05;

export type Centroids = {
  nos: number[];
  // nos.length vectors of EMBEDDING_DIM, each of length 1
  vecs: Float32Array;
};

// A vec0 column comes back as a Buffer, not always 4-byte aligned: copied into its own array
function floats(buf: Buffer): Float32Array {
  const out = new Float32Array(buf.byteLength / 4);
  new Uint8Array(out.buffer).set(buf);
  return out;
}

// Rows of (episode, point vector), ordered by episode. Episodes without points are left out.
export function buildCentroids(rows: Iterable<{ episode_no: number; embedding: Buffer }>): Centroids {
  const nos: number[] = [];
  const sums: Float64Array[] = [];
  for (const r of rows) {
    if (nos.at(-1) !== r.episode_no) {
      nos.push(r.episode_no);
      sums.push(new Float64Array(EMBEDDING_DIM));
    }
    const v = floats(r.embedding);
    const s = sums.at(-1)!;
    for (let i = 0; i < EMBEDDING_DIM; i++) s[i]! += v[i] ?? 0;
  }
  const vecs = new Float32Array(nos.length * EMBEDDING_DIM);
  sums.forEach((s, k) => {
    let n = 0;
    for (let i = 0; i < EMBEDDING_DIM; i++) n += s[i]! * s[i]!;
    n = Math.sqrt(n) || 1;
    for (let i = 0; i < EMBEDDING_DIM; i++) vecs[k * EMBEDDING_DIM + i] = s[i]! / n;
  });
  return { nos, vecs };
}

// Up to k episodes nearest to one, nearest first, leaving out `exclude` (and the episode
// itself) and any more than RELATED_MAX_DROP below the nearest. Empty when it has no points.
export function nearestEpisodes(c: Centroids, no: number, k: number, exclude: Iterable<number> = [], maxDrop = RELATED_MAX_DROP): number[] {
  const at = c.nos.indexOf(no);
  if (at < 0) return [];
  const skip = new Set([no, ...exclude]);
  const q = c.vecs.subarray(at * EMBEDDING_DIM, (at + 1) * EMBEDDING_DIM);
  const scored: { no: number; s: number }[] = [];
  c.nos.forEach((other, j) => {
    if (skip.has(other)) return;
    const v = c.vecs.subarray(j * EMBEDDING_DIM, (j + 1) * EMBEDDING_DIM);
    let s = 0;
    for (let i = 0; i < EMBEDDING_DIM; i++) s += q[i]! * v[i]!;
    scored.push({ no: other, s });
  });
  // Ties (identical summaries) go to the newer episode
  const top = scored.sort((a, b) => b.s - a.s || b.no - a.no).slice(0, k);
  return top.filter((x) => x.s >= top[0]!.s - maxDrop).map((x) => x.no);
}

// What the centroids were built from: which episodes are live, and the points. Not updated_at:
// transcript edits move it without touching the points, and the worker fills in missing points
// without moving it. Point ids are reused when the episode holding the highest ones is
// rewritten (no AUTOINCREMENT), so the points' text is summed in too: a rewrite happens because
// the text changed.
function version(db: DB): string {
  const e = db.prepare(`SELECT COUNT(*) AS n, SUM(episode_no) AS s FROM episodes WHERE status = 'done'`).get() as { n: number; s: number | null };
  const p = db.prepare(`SELECT COUNT(*) AS n, MAX(id) AS top, SUM(id * length(text)) AS sig FROM summary_points`).get() as {
    n: number;
    top: number | null;
    sig: number | null;
  };
  return `${e.n} ${e.s} ${p.n} ${p.top} ${p.sig}`;
}

export function loadCentroids(db: DB): Centroids {
  const rows = db
    .prepare(
      `SELECT e.episode_no, v.embedding
       FROM summary_points p
       JOIN summary_points_vec v ON v.rowid = p.id
       JOIN episodes e ON e.id = p.episode_id
       WHERE e.status = 'done'
       ORDER BY e.episode_no, p.id`,
    )
    .iterate() as Iterable<{ episode_no: number; embedding: Buffer }>;
  return buildCentroids(rows);
}

// The version reads every point's text (about 4 ms locally), so it is checked at most this
// often: a new episode or rewritten points show up within it
export const RELATED_RECHECK_MS = 10_000;

// Kept until an episode or its points change (about 4.4 MB for 714 episodes), with each
// episode's answer once asked for. Rebuilding reads every point vector (about 0.25 s locally),
// like stockData() rebuilding its index, a few times a week.
let cached: ({ version: string; checkedAt: number; answers: Map<string, number[]> } & Centroids) | undefined;

// The episodes nearest to one, for its page. Empty on a database without summary points
// (a snapshot from before them), so the section is left out rather than the page failing.
export async function relatedEpisodes(no: number, exclude: number[] = [], k = RELATED_COUNT): Promise<number[]> {
  const d = await readDb();
  const now = Date.now();
  if (!cached || now - cached.checkedAt >= RELATED_RECHECK_MS) {
    if (!hasTable(d, 'summary_points') || !hasTable(d, 'summary_points_vec')) return [];
    const v = version(d);
    if (cached?.version === v) cached.checkedAt = now;
    else cached = { version: v, checkedAt: now, answers: new Map(), ...loadCentroids(d) };
  }
  const key = `${no} ${k} ${exclude.join(',')}`;
  let answer = cached.answers.get(key);
  if (!answer) cached.answers.set(key, (answer = nearestEpisodes(cached, no, k, exclude)));
  return answer;
}
