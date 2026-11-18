import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DB, EMBEDDING_DIM, openDb, toVecBlob } from '@/lib/db.ts';

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('@/lib/server-db.ts', () => ({ readDb: async () => mocks.db }));

const { adjacentEpisodes, episodesByNo } = await import('@/lib/episodes.ts');
const { buildCentroids, nearestEpisodes, RELATED_RECHECK_MS, relatedEpisodes } = await import('@/lib/related.ts');

// The centroids are kept between calls and checked again only after RELATED_RECHECK_MS
vi.useFakeTimers({ toFake: ['Date'] });
const later = () => vi.setSystemTime(Date.now() + RELATED_RECHECK_MS);

// A unit vector with weight on the given dimensions
const vec = (...dims: [number, number][]) => {
  const v = Array<number>(EMBEDDING_DIM).fill(0);
  for (const [i, w] of dims) v[i] = w;
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};

function addEpisode(db: DB, no: number, status = 'done', line = `EP${no} 的一句話`) {
  const summary = JSON.stringify({ line, keys: [], chapters: [], stocks: [], mentions: [] });
  db.prepare(
    `INSERT INTO episodes (episode_no, guid, title, published_at, audio_url, status, summary_json)
     VALUES (?, ?, '⭐', ?, 'https://x', ?, ?)`,
  ).run(no, `g${no}`, `2026-01-${String(no).padStart(2, '0')}T00:00:00Z`, status, summary);
  return (db.prepare('SELECT id FROM episodes WHERE episode_no = ?').get(no) as { id: number }).id;
}

function addPoints(db: DB, episodeId: number, vectors: number[][]) {
  for (const v of vectors) {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO summary_points (episode_id, start_sec, end_sec, text) VALUES (?, 0, NULL, ?)')
      .run(episodeId, 'x');
    db.prepare('INSERT INTO summary_points_vec (rowid, embedding) VALUES (?, ?)').run(BigInt(lastInsertRowid), toVecBlob(v));
  }
}

let db: DB;
beforeEach(() => {
  later();
  db = openDb(':memory:');
  mocks.db = db;
});

describe('adjacentEpisodes', () => {
  it('steps over numbers that are missing or not live', async () => {
    addEpisode(db, 1);
    addEpisode(db, 2, 'failed');
    addEpisode(db, 3);
    addEpisode(db, 5);
    const { prev, next } = await adjacentEpisodes(3);
    expect(prev?.no).toBe(1);
    expect(next?.no).toBe(5);
    expect(next?.line).toBe('EP5 的一句話');
  });

  it('has no previous one for the oldest and no next one for the newest', async () => {
    addEpisode(db, 1);
    addEpisode(db, 2);
    expect((await adjacentEpisodes(1)).prev).toBeNull();
    expect((await adjacentEpisodes(2)).next).toBeNull();
  });
});

describe('episodesByNo', () => {
  it('keeps the order asked for and leaves out episodes that are not live', async () => {
    addEpisode(db, 1);
    addEpisode(db, 2, 'summarizing');
    addEpisode(db, 3);
    expect((await episodesByNo([3, 2, 1])).map((e) => e.no)).toEqual([3, 1]);
    expect(await episodesByNo([])).toEqual([]);
  });
});

describe('nearestEpisodes', () => {
  const row = (episode_no: number, v: number[]) => ({ episode_no, embedding: toVecBlob(v) });

  it('ranks episodes by the mean of their points', () => {
    const c = buildCentroids([
      // Episode 1's mean leans to dimension 0
      row(1, vec([0, 1])),
      row(1, vec([0, 1], [1, 1])),
      row(2, vec([0, 1])), // near
      row(3, vec([0, 1], [1, 2])), // further
      row(4, vec([2, 1])), // unrelated
    ]);
    expect(nearestEpisodes(c, 1, 3, [], Infinity)).toEqual([2, 3, 4]);
    expect(nearestEpisodes(c, 1, 2, [2], Infinity)).toEqual([3, 4]);
  });

  it('reads vectors that are not 4-byte aligned in their buffer', () => {
    const blob = toVecBlob(vec([5, 1]));
    const odd = Buffer.alloc(blob.length + 1);
    blob.copy(odd, 1);
    const c = buildCentroids([{ episode_no: 1, embedding: odd.subarray(1) }, row(2, vec([5, 1])), row(3, vec([6, 1]))]);
    expect(nearestEpisodes(c, 1, 1)).toEqual([2]);
  });

  it('leaves out episodes much further than the nearest one', () => {
    const c = buildCentroids([
      row(1, vec([0, 1])),
      row(2, vec([0, 1], [1, 0.1])), // 0.995
      row(3, vec([0, 1], [1, 0.2])), // 0.981
      row(4, vec([0, 1], [1, 0.6])), // 0.857, more than 0.05 below the nearest
    ]);
    expect(nearestEpisodes(c, 1, 3)).toEqual([2, 3]);
  });

  it('gives ties to the newer episode and nothing for an episode without points', () => {
    const c = buildCentroids([row(1, vec([0, 1])), row(2, vec([1, 1])), row(3, vec([1, 1]))]);
    expect(nearestEpisodes(c, 1, 2)).toEqual([3, 2]);
    expect(nearestEpisodes(c, 9, 2)).toEqual([]);
  });
});

describe('relatedEpisodes', () => {
  it('reads the live episodes from the database and rebuilds when points change', async () => {
    const a = addEpisode(db, 1);
    const b = addEpisode(db, 2);
    const c = addEpisode(db, 3);
    const hidden = addEpisode(db, 4, 'failed');
    addPoints(db, a, [vec([0, 1]), vec([0, 1], [1, 0.01])]);
    addPoints(db, b, [vec([0, 1], [1, 0.2])]);
    addPoints(db, c, [vec([0, 1], [1, 0.1])]);
    addPoints(db, hidden, [vec([0, 1])]);
    expect(await relatedEpisodes(1)).toEqual([3, 2]);
    expect(await relatedEpisodes(1, [3])).toEqual([2]);

    // The worker fills in points for an episode without moving updated_at
    const d = addEpisode(db, 5);
    later();
    expect(await relatedEpisodes(1)).toEqual([3, 2]);
    addPoints(db, d, [vec([0, 1]), vec([0, 1], [1, 0.01])]);
    // Not until the next check
    expect(await relatedEpisodes(1)).toEqual([3, 2]);
    later();
    expect(await relatedEpisodes(1)).toEqual([5, 3, 2]);
  });

  it('notices points rewritten under the same ids', async () => {
    const a = addEpisode(db, 1);
    const b = addEpisode(db, 2);
    const c = addEpisode(db, 3);
    addPoints(db, a, [vec([0, 1])]);
    addPoints(db, b, [vec([0, 1], [1, 0.1])]);
    addPoints(db, c, [vec([0, 1], [1, 0.2])]);
    expect(await relatedEpisodes(1)).toEqual([2, 3]);

    // The worker rewrites episode 3's points (the highest ids): SQLite hands out the same id
    const old = db.prepare('SELECT id FROM summary_points WHERE episode_id = ?').get(c) as { id: number };
    db.prepare('DELETE FROM summary_points_vec WHERE rowid = ?').run(BigInt(old.id));
    db.prepare('DELETE FROM summary_points WHERE episode_id = ?').run(c);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO summary_points (episode_id, start_sec, end_sec, text) VALUES (?, 0, NULL, ?)')
      .run(c, '改寫後的重點');
    expect(Number(lastInsertRowid)).toBe(old.id);
    db.prepare('INSERT INTO summary_points_vec (rowid, embedding) VALUES (?, ?)').run(BigInt(lastInsertRowid), toVecBlob(vec([0, 1])));
    later();
    expect(await relatedEpisodes(1)).toEqual([3, 2]);
  });

  it('is empty on a database without summary points', async () => {
    addEpisode(db, 1);
    db.exec('DROP TABLE summary_points_vec; DROP TABLE summary_points;');
    expect(await relatedEpisodes(1)).toEqual([]);
  });
});
