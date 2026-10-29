import { beforeEach, describe, expect, it } from 'vitest';
import { type DB, EMBEDDING_DIM, openDb, toVecBlob } from '@/lib/db.ts';
import type { Summary } from '@/lib/summary.ts';
import {
  getEpisode,
  insertDiscovered,
  markFailed,
  maxEpisodeNo,
  publishEpisode,
  saveSegments,
  workQueue,
} from '../worker/repo.ts';

const rss = (n: number) => ({
  guid: `g${n}`,
  episodeNo: n,
  title: '⭐',
  publishedAt: '2026-10-28T08:13:55.000Z',
  audioUrl: `https://example.com/${n}.mp3`,
  duration: 3000,
});

const vec = (hot: number) => Array.from({ length: EMBEDDING_DIM }, (_, i) => (i === hot ? 1 : 0));

const summary: Summary = {
  line: '盤勢',
  keys: [{ t: 60, text: '重點' }],
  chapters: [{ t: 0, title: '盤勢', ad: false, bullets: [{ t: 10, text: 'x' }], quote: null }],
  stocks: [{ name: '台積電', code: '2330', t: 100, note: '修正時躲進台積' }],
  mentions: [{ category: '運動', name: '網球', t: 1849, quote: '每天跑去打網球' }],
};

let db: DB;
beforeEach(() => {
  db = openDb(':memory:');
});

describe('episodes', () => {
  it('inserts once per guid and tracks the newest episode', () => {
    expect(maxEpisodeNo(db)).toBeNull();
    expect(insertDiscovered(db, rss(709))).toBe(true);
    expect(insertDiscovered(db, rss(709))).toBe(false);
    insertDiscovered(db, rss(708));
    expect(maxEpisodeNo(db)).toBe(709);
  });

  it('stops retrying after three failures', () => {
    insertDiscovered(db, rss(709));
    const id = getEpisode(db, 709)!.id;
    expect(workQueue(db)).toHaveLength(1);
    markFailed(db, id, 'boom', 'summarize');
    markFailed(db, id, 'boom', 'summarize');
    expect(workQueue(db)).toHaveLength(1);
    expect(markFailed(db, id, 'boom', 'summarize')).toBe(3);
    expect(workQueue(db)).toHaveLength(0);
    expect(getEpisode(db, 709)).toMatchObject({ status: 'failed', error: 'boom', retries: 3 });
  });
});

describe('publishEpisode', () => {
  const chunks = [
    { idx: 0, startSec: 0, text: '今天先聊台股盤勢，台積電修正' },
    { idx: 1, startSec: 600, text: '週末去苗栗吃了一家客家菜' },
  ];

  function publish() {
    insertDiscovered(db, rss(709));
    const id = getEpisode(db, 709)!.id;
    saveSegments(db, id, [{ start: 0, end: 5, text: 'x' }], 3135, 0.1);
    const total = publishEpisode(db, id, { summary, chunks, vectors: [vec(0), vec(1)], costUsd: 0.25 });
    return { id, total };
  }

  it('writes chunks, mentions and marks the episode done', () => {
    const { total } = publish();
    expect(total).toBeCloseTo(0.35);
    expect(getEpisode(db, 709)).toMatchObject({ status: 'done', duration: 3135 });
    const cats = db.prepare('SELECT category, name, code FROM mentions ORDER BY id').all();
    expect(cats).toEqual([
      { category: '股票', name: '台積電', code: '2330' },
      { category: '運動', name: '網球', code: null },
    ]);
    expect(workQueue(db)).toHaveLength(0);
  });

  it('indexes chunks for trigram FTS and vector search', () => {
    publish();
    const fts = db.prepare(`SELECT c.start_sec FROM chunks_fts f JOIN chunks c ON c.id = f.rowid WHERE chunks_fts MATCH ?`);
    expect(fts.all('"客家菜"')).toEqual([{ start_sec: 600 }]);
    const knn = db.prepare(
      `SELECT c.start_sec FROM chunks_vec v JOIN chunks c ON c.id = v.rowid
       WHERE v.embedding MATCH ? AND k = 1`,
    );
    expect(knn.all(toVecBlob(vec(1)))).toEqual([{ start_sec: 600 }]);
  });

  it('replaces earlier rows when an episode is re-published', () => {
    const { id } = publish();
    publishEpisode(db, id, { summary, chunks: chunks.slice(0, 1), vectors: [vec(0)], costUsd: 0 });
    const count = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    expect(count('chunks')).toBe(1);
    expect(count('chunks_vec')).toBe(1);
    expect(count('mentions')).toBe(2);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM chunks_fts WHERE chunks_fts MATCH '"客家菜"'`).get()).toEqual({ n: 0 });
  });
});
