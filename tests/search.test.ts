import { beforeEach, describe, expect, it } from 'vitest';
import { type DB, EMBEDDING_DIM, openDb } from '@/lib/db';
import { MIN_TERM_CHARS, parseQuery, relatedPages, SEARCH_MAX_TERMS, SEARCH_PER_PAGE, siteSearch, SNIPPETS_SHOWN, type SearchEpisode } from '@/lib/search';
import type { Segment } from '@/lib/segments';
import { buildSponsorIndex } from '@/lib/sponsors';
import { buildStockIndex } from '@/lib/stocks';
import { buildTopicIndex } from '@/lib/topics';
import { chunkSegments } from '../worker/chunk.ts';
import { insertDiscovered, publishEpisode, saveSegments } from '../worker/repo.ts';

const vec = () => Array.from({ length: EMBEDDING_DIM }, (_, k) => (k === 0 ? 1 : 0));

// One segment every 10 s, holding the given texts in order
const segs = (...texts: string[]): Segment[] => texts.map((text, i) => ({ start: i * 10, end: i * 10 + 10, text }));

function addEpisode(db: DB, no: number, segments: Segment[], opts: { points?: string[]; date?: string; status?: 'done' | 'failed' } = {}) {
  insertDiscovered(db, { guid: `g${no}`, episodeNo: no, title: '⭐', publishedAt: opts.date ?? `2026-01-${String(no).padStart(2, '0')}T07:00:00.000Z`, audioUrl: 'https://x', duration: 3000 });
  const id = (db.prepare('SELECT id FROM episodes WHERE episode_no = ?').get(no) as { id: number }).id;
  saveSegments(db, id, segments, 3000, 0);
  const chunks = chunkSegments(segments, 60);
  const points = (opts.points ?? []).map((text) => ({ startSec: 20, endSec: null, text }));
  publishEpisode(db, id, {
    summary: { line: `EP${no} 的一句話`, keys: [], chapters: [], stocks: [], mentions: [] },
    chunks,
    vectors: chunks.map(vec),
    points,
    pointVectors: points.map(vec),
    costUsd: 0,
  });
  if (opts.status === 'failed') db.prepare(`UPDATE episodes SET status = 'failed' WHERE id = ?`).run(id);
}

const marked = (e: SearchEpisode) => e.snippets.map((s) => s.parts.filter((p) => p.mark).map((p) => p.text));
const nos = (r: { episodes: SearchEpisode[] }) => r.episodes.map((e) => e.no);

let db: DB;
beforeEach(() => {
  db = openDb(':memory:');
});

describe('parseQuery', () => {
  it('splits on spaces, once each, ignoring case', () => {
    expect(parseQuery('  台積電   法說會 台積電 ').terms).toEqual(['台積電', '法說會']);
    expect(parseQuery('NVIDIA nvidia').terms).toEqual(['NVIDIA']);
    expect(parseQuery(undefined).terms).toEqual([]);
    expect(parseQuery(['a', 'b']).terms).toEqual([]);
  });

  it('leaves out terms too short to mean anything, and past the limit', () => {
    const q = parseQuery('美 台積電 a 一二 三四 五六 七八 九十');
    expect(MIN_TERM_CHARS).toBe(2);
    expect(q.short).toEqual(['美', 'a']);
    expect(q.terms).toHaveLength(SEARCH_MAX_TERMS);
    expect(q.extra).toEqual(['九十']);
  });

  it('cuts the query by code point, never inside a character', () => {
    const q = parseQuery('𠮷'.repeat(60));
    expect([...q.q]).toHaveLength(50);
    expect(q.q).toBe('𠮷'.repeat(50));
  });
});

describe('siteSearch', () => {
  beforeEach(() => {
    addEpisode(db, 1, segs('今天聊台積電', '天氣很好', '台積電法說會', '其他事情', '收工'));
    addEpisode(db, 2, segs('最近在玩遊戲', '聊一下 NVIDIA 的財報', '輝達這次很強'), { points: ['輝達財報：營收創新高'] });
    addEpisode(db, 3, segs('台積電', '輝達'), { status: 'failed' });
  });

  it('finds the words as written, ignoring the case of Latin letters, in live episodes only', () => {
    expect(nos(siteSearch(db, ['台積電']))).toEqual([1]);
    expect(nos(siteSearch(db, ['nvidia']))).toEqual([2]);
    // two characters: LIKE rather than the trigram index
    expect(nos(siteSearch(db, ['輝達']))).toEqual([2]);
    expect(siteSearch(db, ['沒有這個詞']).total).toBe(0);
  });

  it('lists only episodes with every term, in the transcript or the summary', () => {
    expect(nos(siteSearch(db, ['台積電', '法說會']))).toEqual([1]);
    expect(nos(siteSearch(db, ['台積電', '輝達']))).toEqual([]);
    // 營收 is only in EP2's summary point
    expect(nos(siteSearch(db, ['營收', '遊戲']))).toEqual([2]);
  });

  it('times each passage to the segment its words are in and links there with them', () => {
    const [e] = siteSearch(db, ['法說會']).episodes;
    expect(e!.snippets).toEqual([{ t: 20, hl: '法說會', parts: [{ text: '今天聊台積電，天氣很好，台積電', mark: false }, { text: '法說會', mark: true }, { text: '，其他事情，收工', mark: false }] }]);
  });

  it('marks every term in a passage', () => {
    const [e] = siteSearch(db, ['台積電', '法說會']).episodes;
    expect(marked(e!)[0]).toEqual(['台積電', '台積電', '法說會']);
  });

  it('shows a summary point that has the words, with its time', () => {
    const [e] = siteSearch(db, ['營收']).episodes;
    expect(e!.point).toEqual({ t: 20, parts: [{ text: '輝達財報：', mark: false }, { text: '營收', mark: true }, { text: '創新高', mark: false }] });
    expect(e!.snippets).toEqual([]);
    expect(siteSearch(db, ['遊戲']).episodes[0]!.point).toBeNull();
  });
});

describe('passages', () => {
  it('keeps one passage per 30 seconds and counts the rest', () => {
    // 台積電 at 0, 10 (same passage), 40, 80, 120, 160 s
    const texts = Array.from({ length: 17 }, (_, i) => ([0, 1, 4, 8, 12, 16].includes(i) ? `第${i}段台積電` : `第${i}段`));
    addEpisode(db, 1, segs(...texts));
    const [e] = siteSearch(db, ['台積電']).episodes;
    expect(e!.snippets.map((s) => s.t)).toEqual([0, 40, 80]);
    expect(SNIPPETS_SHOWN).toBe(3);
    expect(e!.more).toEqual({ count: 2, t: 120, hl: '台積電' });
  });

  it('keeps a long talk about it as one passage', () => {
    // every 10 s for two minutes, then once more a minute later
    addEpisode(db, 1, segs(...Array.from({ length: 20 }, (_, i) => (i < 12 || i === 18 ? `台積電${i}` : `別的${i}`))));
    const [e] = siteSearch(db, ['台積電']).episodes;
    expect(e!.snippets.map((s) => s.t)).toEqual([0, 180]);
    expect(e!.more).toBeNull();
  });

  it('ignores case even where lowercasing changes the length of the text', () => {
    // İ lowercases to two code units
    addEpisode(db, 1, segs('İstanbul 之後', '聊 NVIDIA'));
    const [e] = siteSearch(db, ['nvidia']).episodes;
    expect(marked(e!)).toEqual([['NVIDIA']]);
  });

  it('cuts the passage around the words, marking where it was cut', () => {
    addEpisode(db, 1, segs('前'.repeat(60), '台積電', '後'.repeat(60)));
    const parts = siteSearch(db, ['台積電']).episodes[0]!.snippets[0]!.parts;
    expect(parts[0]).toEqual({ text: '…', mark: false });
    expect(parts.at(-1)).toEqual({ text: '…', mark: false });
    expect(parts.find((p) => p.mark)?.text).toBe('台積電');
  });
});

describe('ranking', () => {
  beforeEach(() => {
    // EP1: once; EP2: three times; EP3: once, but in its summary; EP4: three times, newest
    addEpisode(db, 1, segs('台積電'), { date: '2026-01-01T07:00:00.000Z' });
    addEpisode(db, 2, segs(...Array.from({ length: 30 }, (_, i) => (i % 10 === 0 ? '台積電' : '別的話題聊很久'))), { date: '2026-01-02T07:00:00.000Z' });
    addEpisode(db, 3, segs('台積電'), { date: '2026-01-03T07:00:00.000Z', points: ['台積電法說'] });
    addEpisode(db, 4, segs(...Array.from({ length: 30 }, (_, i) => (i % 10 === 0 ? '台積電' : '別的話題聊很久'))), { date: '2026-01-04T07:00:00.000Z' });
  });

  it('puts an episode whose summary has the words first, then more passages, then newer', () => {
    expect(nos(siteSearch(db, ['台積電']))).toEqual([3, 4, 2, 1]);
  });

  it('sorts by date when asked', () => {
    expect(nos(siteSearch(db, ['台積電'], 'new'))).toEqual([4, 3, 2, 1]);
  });

  it('pages the episodes, keeping the page in range', () => {
    for (let no = 10; no < 10 + SEARCH_PER_PAGE; no++) addEpisode(db, no, segs('台積電'), { date: `2025-12-${String(no - 9).padStart(2, '0')}T07:00:00.000Z` });
    const two = siteSearch(db, ['台積電'], 'new', 2);
    expect(two).toMatchObject({ total: 24, page: 2, pages: 2 });
    expect(two.episodes).toHaveLength(4);
    expect(siteSearch(db, ['台積電'], 'new', 99).page).toBe(2);
    expect(siteSearch(db, ['台積電'], 'new', 0).page).toBe(1);
  });
});

describe('by sound', () => {
  beforeEach(() => {
    addEpisode(db, 708, segs('四個字是哪裡來的梗啊？', '交言肥腸。', '下面一位'));
    addEpisode(db, 709, segs('台積電法說會重點'));
  });

  it('finds a name the transcript wrote with other characters that sound the same', () => {
    const r = siteSearch(db, ['椒鹽肥腸']);
    expect(r.soundTerms).toEqual(['椒鹽肥腸']);
    expect(nos(r)).toEqual([708]);
    expect(r.episodes[0]!.snippets[0]).toMatchObject({ t: 10, hl: '交言肥腸' });
    expect(marked(r.episodes[0]!)[0]).toEqual(['交言肥腸']);
  });

  it('only when the words are nowhere as written, and never for short terms', () => {
    expect(siteSearch(db, ['台積電']).soundTerms).toEqual([]);
    // 交言 and 椒鹽 sound the same, but two characters share their sound with too many words
    expect(siteSearch(db, ['椒鹽']).total).toBe(0);
  });
});

describe('relatedPages', () => {
  const stock = (name: string, code: string | null, no: number) => ({ episodeNo: no, title: '⭐', audioUrl: 'https://x', publishedAt: '2026-01-01T00:00:00Z', name, code, detail: '', startSec: 0 });
  const pages = {
    index: buildStockIndex([stock('台積電', '2330', 1), stock('台積電', 'TSM', 2), stock('台積電ADR', 'TSM', 3), stock('聯發科', '2454', 1)]),
    topics: buildTopicIndex([{ episodeNo: 1, title: '⭐', audioUrl: 'https://x', publishedAt: '2026-01-01T00:00:00Z', category: '遊戲', name: '死亡擱淺2', quote: '', startSec: 0 }]),
    sponsors: buildSponsorIndex([]),
  };

  it('finds a page by its name, code or another name, the exact ones first', () => {
    // the topic is named as its alias groups it (死亡擱淺2 is 死亡擱淺)
    expect(relatedPages(pages, '台積電').map((p) => p.name)).toEqual(['台積電']);
    expect(relatedPages(pages, 'tsm').map((p) => p.href)).toEqual(['/stock/2330']);
    expect(relatedPages(pages, '死亡擱淺')).toEqual([{ kind: '電玩', name: '死亡擱淺', href: expect.stringContaining('/topic/'), episodes: 1 }]);
    expect(relatedPages(pages, '台')).toEqual([]);
  });
});
