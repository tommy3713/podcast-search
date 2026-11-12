import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchTranscript } from '@/lib/ask/search.ts';
import { type DB, EMBEDDING_DIM, openDb } from '@/lib/db.ts';
import type { Summary } from '@/lib/summary.ts';

const mocks = vi.hoisted(() => ({ embed: vi.fn() }));
vi.mock('../worker/embed.ts', () => ({ embed: mocks.embed }));

const { summaryPoints } = await import('../worker/chunk.ts');
const { insertDiscovered, publishEpisode, saveSegments } = await import('../worker/repo.ts');
const { indexSummaries } = await import('../worker/summary-index.ts');

// A vector with weight on the given dimensions
const vec = (...dims: [number, number][]) => {
  const v = Array<number>(EMBEDDING_DIM).fill(0);
  for (const [i, w] of dims) v[i] = w;
  return v;
};

const summary: Summary = {
  line: '',
  keys: [
    { t: 700, text: '有人冒用他的名義推股' },
    { t: 1900, text: '業配' },
  ],
  chapters: [
    { t: 0, title: '開場', ad: false, bullets: [{ t: 10, text: '閒聊天氣' }], quote: null },
    { t: 650, title: '冒名推股澄清', ad: false, bullets: [{ t: 660, text: '群組有人說認識他' }, { t: 700, text: '他沒有私下推薦' }], quote: null },
    { t: 1800, title: '業配', ad: true, bullets: [{ t: 1810, text: '某產品' }], quote: null },
  ],
  stocks: [],
  mentions: [],
};

const chunks = ['開場閒聊', '最近有人在群組亂講', '那個人說認識我，我根本不認識他', '這集由某產品贊助'].map((text, i) => ({ idx: i, startSec: i * 600, text }));

function addEpisode(db: DB, no: number, publishedAt: string) {
  insertDiscovered(db, { guid: `g${no}`, episodeNo: no, title: '⭐', publishedAt, audioUrl: 'https://x', duration: 3000 });
  const id = (db.prepare('SELECT id FROM episodes WHERE episode_no = ?').get(no) as { id: number }).id;
  saveSegments(db, id, [], 3000, 0);
  return id;
}

const count = (db: DB, t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;

describe('summaryPoints', () => {
  it('makes one point per chapter and per key point, spanning its chapter, without ads', () => {
    expect(summaryPoints(summary)).toEqual([
      { startSec: 0, endSec: 650, text: '開場：閒聊天氣' },
      { startSec: 650, endSec: 1800, text: '冒名推股澄清：群組有人說認識他 他沒有私下推薦' },
      { startSec: 650, endSec: 1800, text: '有人冒用他的名義推股' },
    ]);
  });

  it('gives a key point before the first chapter the start of the episode', () => {
    const s = { ...summary, keys: [{ t: 5, text: '開頭' }], chapters: [{ ...summary.chapters[1]! }] };
    expect(summaryPoints(s)).toContainEqual({ startSec: 0, endSec: 650, text: '開頭' });
    expect(summaryPoints({ ...s, chapters: [] })).toEqual([{ startSec: 0, endSec: null, text: '開頭' }]);
  });
});

describe('search through the summary', () => {
  let db: DB;
  beforeEach(() => {
    db = openDb(':memory:');
    // EP720: chunk i has vector dimension i, its points 200 (開場), 201 (澄清), 202 (key point)
    const id = addEpisode(db, 720, '2026-11-04T07:00:00.000Z');
    const points = summaryPoints(summary);
    publishEpisode(db, id, {
      summary,
      chunks,
      vectors: chunks.map((_, i) => vec([i, 1])),
      points,
      pointVectors: points.map((_, i) => vec([200 + i, 1])),
      costUsd: 0,
    });
    // EP721: one chunk, no summary points
    const id2 = addEpisode(db, 721, '2026-11-07T07:00:00.000Z');
    publishEpisode(db, id2, { summary: { ...summary, keys: [], chapters: [] }, chunks: [{ idx: 0, startSec: 0, text: '別的' }], vectors: [vec([10, 1])], points: [], pointVectors: [], costUsd: 0 });
  });

  // Near the 澄清 chapter's point, then EP721's chunk, then EP720's chunk 2
  const query = vec([201, 0.9], [10, 0.5], [2, 0.4]);

  it('ranks the chunk of a matching chapter nearest the query first, as transcript text', () => {
    const { hits } = searchTranscript(db, '', query);
    expect(hits[0]).toEqual({ episodeNo: 720, publishedAt: '2026-11-04T07:00:00.000Z', startSec: 1200, text: chunks[2]!.text });
    expect(hits.some((h) => h.text.includes('澄清'))).toBe(false);
  });

  it('without summary points, the chunk vectors alone put the other episode first', () => {
    db.exec('DELETE FROM summary_points; DELETE FROM summary_points_vec;');
    expect(searchTranscript(db, '', query).hits[0]!.episodeNo).toBe(721);
  });

  it('searches without the summary on a database from before it (readonly, not migrated)', () => {
    db.exec('DROP TABLE summary_points_vec; DROP TABLE summary_points;');
    expect(searchTranscript(db, '', query).hits[0]!.episodeNo).toBe(721);
  });

  it('keeps summary hits inside the scope', () => {
    expect(new Set(searchTranscript(db, '', query, { episode: 721 }).hits.map((h) => h.episodeNo))).toEqual(new Set([721]));
  });

  it('replaces the points when an episode is published again', () => {
    expect(count(db, 'summary_points')).toBe(3);
    const id = (db.prepare('SELECT id FROM episodes WHERE episode_no = 720').get() as { id: number }).id;
    const points = summaryPoints({ ...summary, keys: [] });
    publishEpisode(db, id, { summary, chunks, vectors: chunks.map((_, i) => vec([i, 1])), points, pointVectors: points.map(() => vec([0, 1])), costUsd: 0 });
    expect(count(db, 'summary_points')).toBe(2);
    expect(count(db, 'summary_points_vec')).toBe(2);
  });

  it('refuses vectors that do not match the points or chunks', () => {
    const id = (db.prepare('SELECT id FROM episodes WHERE episode_no = 720').get() as { id: number }).id;
    expect(() => publishEpisode(db, id, { summary, chunks, vectors: [], points: [], pointVectors: [], costUsd: 0 })).toThrow('4 chunks but 0 vectors');
    expect(() =>
      publishEpisode(db, id, { summary, chunks, vectors: chunks.map(() => vec([0, 1])), points: summaryPoints(summary), pointVectors: [], costUsd: 0 }),
    ).toThrow('3 summary points but 0 vectors');
    // The failed publish rolled back, so the live version is untouched
    expect(count(db, 'chunks')).toBe(5);
    expect(count(db, 'summary_points')).toBe(3);
  });
});

describe('indexSummaries', () => {
  it('embeds the points of live episodes published without them, once', async () => {
    const db = openDb(':memory:');
    const id = addEpisode(db, 720, '2026-11-04T07:00:00.000Z');
    publishEpisode(db, id, { summary, chunks, vectors: chunks.map((_, i) => vec([i, 1])), points: [], pointVectors: [], costUsd: 0.5 });
    // Not live yet: left for its own publish
    const pending = addEpisode(db, 721, '2026-11-07T07:00:00.000Z');
    db.prepare(`UPDATE episodes SET summary_json = ? WHERE id = ?`).run(JSON.stringify(summary), pending);
    mocks.embed.mockImplementation(async (texts: string[]) => ({ vectors: texts.map(() => vec([0, 1])), costUsd: 0.001 }));

    expect(await indexSummaries(db)).toEqual({ episodes: 1, points: 3, failed: [], costUsd: 0.001 });
    expect(mocks.embed).toHaveBeenCalledWith(summaryPoints(summary).map((p) => p.text));
    expect(db.prepare('SELECT episode_id, start_sec, end_sec FROM summary_points ORDER BY id').all()).toEqual([
      { episode_id: id, start_sec: 0, end_sec: 650 },
      { episode_id: id, start_sec: 650, end_sec: 1800 },
      { episode_id: id, start_sec: 650, end_sec: 1800 },
    ]);
    expect(count(db, 'summary_points_vec')).toBe(3);
    expect((db.prepare('SELECT cost_usd FROM episodes WHERE id = ?').get(id) as { cost_usd: number }).cost_usd).toBeCloseTo(0.501);

    mocks.embed.mockClear();
    expect(await indexSummaries(db)).toEqual({ episodes: 0, points: 0, failed: [], costUsd: 0 });
    expect(mocks.embed).not.toHaveBeenCalled();
  });

  // Episodes 720 and 721 live with the given summaries, published without points
  function live(summaries: Summary[]) {
    const db = openDb(':memory:');
    return {
      db,
      ids: summaries.map((s, i) => {
        const id = addEpisode(db, 720 + i, `2026-11-0${4 + i}T07:00:00.000Z`);
        publishEpisode(db, id, { summary: s, chunks, vectors: chunks.map((_, j) => vec([j, 1])), points: [], pointVectors: [], costUsd: 0 });
        return id;
      }),
    };
  }

  it('replaces points left from an earlier summary, and removes them when there are none now', async () => {
    const other = { ...summary, keys: [], chapters: [] };
    const { db, ids } = live([summary, other]);
    // What a release from before summary search leaves after re-running both episodes
    db.prepare(`INSERT INTO summary_points (episode_id, start_sec, end_sec, text) VALUES (?, 0, NULL, '舊的章節')`).run(ids[0]);
    db.prepare(`INSERT INTO summary_points (episode_id, start_sec, end_sec, text) VALUES (?, 0, NULL, '舊的章節')`).run(ids[1]);
    db.exec(`INSERT INTO summary_points_vec (rowid, embedding) SELECT id, vec_f32(zeroblob(${EMBEDDING_DIM * 4})) FROM summary_points`);
    mocks.embed.mockImplementation(async (texts: string[]) => ({ vectors: texts.map(() => vec([0, 1])), costUsd: 0 }));

    expect(await indexSummaries(db)).toMatchObject({ episodes: 2, points: 3, failed: [] });
    expect(db.prepare('SELECT episode_id, text FROM summary_points ORDER BY id').all()).toEqual(
      summaryPoints(summary).map((p) => ({ episode_id: ids[0], text: p.text })),
    );
    expect(count(db, 'summary_points_vec')).toBe(3);
  });

  it('embeds several episodes per request, and a failed request leaves only its episodes for next time', async () => {
    // 60 key points each, so two episodes don't fit one 100-text request
    const big = { ...summary, chapters: [], keys: Array.from({ length: 60 }, (_, i) => ({ t: i, text: `重點${i}` })) };
    const { db } = live([summary, big, big]);
    mocks.embed.mockClear();
    mocks.embed.mockImplementation(async (texts: string[]) => ({ vectors: texts.map(() => vec([0, 1])), costUsd: 0 }));
    mocks.embed.mockRejectedValueOnce(new Error('OpenAI 500'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Newest first: EP722 (60 texts) alone, which fails; EP721 and EP720 (60 + 3) together
    expect(await indexSummaries(db)).toMatchObject({ episodes: 2, points: 63, failed: [722] });
    expect(mocks.embed.mock.calls.map((c) => (c[0] as string[]).length)).toEqual([60, 63]);
    expect(await indexSummaries(db)).toMatchObject({ episodes: 1, points: 60, failed: [] });
  });

  it('reports an episode whose summary cannot be read and indexes the rest', async () => {
    const { db, ids } = live([summary, summary]);
    db.prepare(`UPDATE episodes SET summary_json = '{' WHERE id = ?`).run(ids[1]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.embed.mockImplementation(async (texts: string[]) => ({ vectors: texts.map(() => vec([0, 1])), costUsd: 0 }));
    expect(await indexSummaries(db)).toMatchObject({ episodes: 1, failed: [721] });
  });
});
