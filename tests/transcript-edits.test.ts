import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DB, EMBEDDING_DIM, openDb } from '@/lib/db.ts';
import type { Segment } from '@/lib/segments.ts';
import type { Summary } from '@/lib/summary.ts';
import { applyEdits, editDiff, replaceMatches } from '@/lib/transcript-edits.ts';

const mocks = vi.hoisted(() => ({
  transcribe: vi.fn(),
  summarize: vi.fn(),
  embed: vi.fn(),
  notify: vi.fn(),
  session: vi.fn(),
  db: undefined as unknown,
}));
vi.mock('../worker/audio.ts', () => ({ download: vi.fn(), compress: vi.fn(async () => ({ parts: [], duration: 3000 })) }));
vi.mock('../worker/seek-table.ts', () => ({ seekTableOfFile: vi.fn(async () => null) }));
vi.mock('../worker/transcribe.ts', () => ({ transcribe: mocks.transcribe }));
vi.mock('../worker/summarize.ts', () => ({ summarize: mocks.summarize }));
vi.mock('../worker/embed.ts', () => ({ embed: mocks.embed }));
vi.mock('../worker/notify.ts', () => ({ notify: mocks.notify }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/lib/server-db.ts', () => ({ readDb: async () => mocks.db, writeDb: async () => mocks.db }));

const { applyPendingEdits, putBackEdits, watchEdits } = await import('../worker/edits.ts');
const { enqueue } = await import('../worker/actions.ts');
const { processEpisode } = await import('../worker/pipeline.ts');
const { getEpisode, insertDiscovered, publishEpisode } = await import('../worker/repo.ts');
const { chunkSegments, summaryPoints } = await import('../worker/chunk.ts');
const { adminEpisode, insertEdits } = await import('@/lib/admin-edits.ts');
const { isAdmin } = await import('@/lib/auth.ts');
const { POST } = await import('@/app/api/admin/edits/route.ts');

const seg = (start: number, text: string): Segment => ({ start, end: start + 4, text });

describe('editDiff', () => {
  it('keeps just the changed words when they are long enough', () => {
    expect(editDiff('他說大股江平很強', '他說大谷翔平很強')).toEqual({ wrong: '大股江', right: '大谷翔', at: 2 });
    expect(editDiff('今天吃交言肥腸好讚', '今天吃椒鹽肥腸好讚')).toEqual({ wrong: '吃交言', right: '吃椒鹽', at: 2 });
    expect(editDiff('買了三星電子', '買了 Samsung')).toEqual({ wrong: '三星電子', right: ' Samsung', at: 2 });
  });

  it('widens a one-character change to three characters', () => {
    expect(editDiff('股票的走勢', '股票得走勢')).toEqual({ wrong: '票的走', right: '票得走', at: 1 });
  });

  it('handles deletions and text shorter than three characters', () => {
    expect(editDiff('謝謝謝謝收看', '謝謝收看')).toEqual({ wrong: '謝謝謝', right: '謝', at: 1 });
    expect(editDiff('ab', 'ac')).toEqual({ wrong: 'ab', right: 'ac', at: 0 });
  });
});

describe('applyEdits', () => {
  const segs = [seg(10, '今天吃交言肥腸'), seg(14, '還有交言肥腸'), seg(100, '交言肥腸又來了')];

  it('applies an edit to the segment it was made on', () => {
    const r = applyEdits(segs, [{ id: 1, segStart: 14, oldText: '還有交言肥腸', newText: '還有椒鹽肥腸' }]);
    expect(r.segments.map((s) => s.text)).toEqual(['今天吃交言肥腸', '還有椒鹽肥腸', '交言肥腸又來了']);
    expect(r.results).toEqual([{ id: 1, outcome: 'exact', index: 1, segStart: 14, oldText: '還有交言肥腸', newText: '還有椒鹽肥腸' }]);
    expect(segs[1]!.text).toBe('還有交言肥腸'); // the input isn't changed
  });

  it('finds the change in the nearest segment when the one it was made on changed', () => {
    // As after a retranscription: other boundaries, other times
    const moved = [seg(9, '今天吃交言肥腸，還有'), seg(15.5, '交言肥腸'), seg(100, '交言肥腸又來了')];
    const r = applyEdits(moved, [{ id: 1, segStart: 14, oldText: '還有交言肥腸', newText: '還有椒鹽肥腸' }]);
    expect(r.segments.map((s) => s.text)).toEqual(['今天吃交言肥腸，還有', '椒鹽肥腸', '交言肥腸又來了']);
    expect(r.results[0]).toMatchObject({ outcome: 'nearby', segStart: 15.5, oldText: '交言肥腸', newText: '椒鹽肥腸' });
  });

  it('says when the text is already right, and when the old words are nowhere near', () => {
    const fixed = [seg(12, '還有椒鹽肥腸')];
    expect(applyEdits(fixed, [{ id: 1, segStart: 14, oldText: '還有交言肥腸', newText: '還有椒鹽肥腸' }]).results[0]!.outcome).toBe('already');
    const far = [seg(60, '還有交言肥腸')];
    expect(applyEdits(far, [{ id: 2, segStart: 14, oldText: '還有交言肥腸', newText: '還有椒鹽肥腸' }]).results[0]!.outcome).toBe('missing');
  });

  it("doesn't add an insertion again where the transcript already has it", () => {
    // 叫做輝 → 叫做輝達 widens to one side only, so the old words are inside the new ones
    const r = applyEdits([seg(20, '這個叫做輝達')], [{ id: 1, segStart: 22, oldText: '這個叫做輝', newText: '這個叫做輝達' }]);
    expect(r.segments[0]!.text).toBe('這個叫做輝達');
    expect(r.results[0]!.outcome).toBe('already');
    // but where it's still missing it goes in
    const again = applyEdits([seg(20, '這個叫做輝，那個')], [{ id: 1, segStart: 22, oldText: '這個叫做輝', newText: '這個叫做輝達' }]);
    expect(again.segments[0]!.text).toBe('這個叫做輝達，那個');
  });

  it('changes the occurrence nearest where the edit was made', () => {
    // The admin fixed the second 那個時候; after a retranscription the segment starts earlier
    const edit = { id: 1, segStart: 10, oldText: '那個時候我說那個時候', newText: '那個時候我說那個時后' };
    const r = applyEdits([seg(8, '嗯那個時候我說那個時候')], [edit]);
    expect(r.segments[0]!.text).toBe('嗯那個時候我說那個時后');
  });

  it('applies edits in order, so a second edit on a segment builds on the first', () => {
    const r = applyEdits(segs, [
      { id: 1, segStart: 10, oldText: '今天吃交言肥腸', newText: '今天吃椒鹽肥腸' },
      { id: 2, segStart: 10, oldText: '今天吃椒鹽肥腸', newText: '今天去吃椒鹽肥腸' },
    ]);
    expect(r.segments[0]!.text).toBe('今天去吃椒鹽肥腸');
    expect(r.results.map((x) => x.outcome)).toEqual(['exact', 'exact']);
  });
});

describe('replaceMatches', () => {
  it('lists each segment with the words and its text with every one replaced', () => {
    expect(replaceMatches([seg(0, '交言交言'), seg(5, '別的'), seg(9, '交言')], '交言', '椒鹽')).toEqual([
      { index: 0, start: 0, oldText: '交言交言', newText: '椒鹽椒鹽', count: 2 },
      { index: 2, start: 9, oldText: '交言', newText: '椒鹽', count: 1 },
    ]);
    expect(replaceMatches([seg(0, 'x')], '', 'y')).toEqual([]);
  });
});

// ── worker ─────────────────────────────────────────────────────────────────────

const summary: Summary = {
  line: '一句話',
  keys: [{ t: 0, text: '重點' }],
  chapters: [{ t: 0, title: '開場', ad: false, bullets: [{ t: 1, text: '打招呼' }], quote: null }],
  stocks: [{ name: '台積電', code: '2330', t: 5, note: '說明' }],
  mentions: [{ category: '美食', name: '肥腸', t: 12, quote: '好吃' }],
};
// Long enough for a few chunks
const segments: Segment[] = Array.from({ length: 40 }, (_, i) =>
  seg(i * 5, i === 20 ? '今天吃交言肥腸真的很讚' : `第${i}句${'內容'.repeat(20)}`),
);

let db: DB;
let epId: number;
const vector = () => Array(EMBEDDING_DIM).fill(0.1);

beforeEach(() => {
  vi.clearAllMocks();
  db = openDb(':memory:');
  mocks.db = db;
  insertDiscovered(db, { guid: 'g709', episodeNo: 709, title: '🐧', publishedAt: '2026-10-31T07:00:00.000Z', audioUrl: 'https://x/709.mp3', duration: 200 });
  epId = getEpisode(db, 709)!.id;
  db.prepare(`UPDATE episodes SET segments_json = ?, duration = 200 WHERE id = ?`).run(JSON.stringify(segments), epId);
  const chunks = chunkSegments(segments);
  const points = summaryPoints(summary);
  publishEpisode(db, epId, {
    summary,
    chunks,
    vectors: chunks.map(vector),
    points,
    pointVectors: points.map(vector),
    costUsd: 0,
  });
  mocks.embed.mockImplementation(async (texts: string[]) => ({ vectors: texts.map(vector), costUsd: 0.0005 }));
});

const fts = (q: string) => (db.prepare('SELECT COUNT(*) AS n FROM chunks_fts WHERE chunks_fts MATCH ?').get(`"${q}"`) as { n: number }).n;
const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const editRows = () => db.prepare('SELECT seg_start, old_text, new_text, applied_at, error FROM transcript_edits ORDER BY id').all() as Record<string, unknown>[];
const fix = (start = 100, oldText = '今天吃交言肥腸真的很讚', newText = '今天吃椒鹽肥腸真的很讚') => insertEdits(db, epId, [{ start, oldText, newText }]);

describe('applyPendingEdits', () => {
  it('fixes the transcript and re-indexes keyword, vector and pinyin search, leaving the summary alone', async () => {
    const before = db.prepare('SELECT summary_json FROM episodes WHERE id = ?').get(epId);
    const mentions = db.prepare('SELECT * FROM mentions ORDER BY id').all();
    const points = db.prepare('SELECT start_sec, end_sec, text FROM summary_points ORDER BY id').all();
    expect(fts('交言肥腸')).toBe(1);
    fix();

    expect(await applyPendingEdits(db, 709)).toEqual({ done: 1, missing: 0 });
    const saved = JSON.parse(getEpisode(db, 709)!.segments_json!) as Segment[];
    expect(saved[20]!.text).toBe('今天吃椒鹽肥腸真的很讚');
    expect(fts('交言肥腸')).toBe(0);
    expect(fts('椒鹽肥腸')).toBe(1);
    expect(count('chunks_vec')).toBe(count('chunks'));
    expect(count('chunks_pinyin')).toBe(count('chunks'));
    // Only the transcript's chunks were embedded
    expect(mocks.embed.mock.calls[0]![0]).toHaveLength(count('chunks'));
    expect(db.prepare('SELECT summary_json FROM episodes WHERE id = ?').get(epId)).toEqual(before);
    expect(db.prepare('SELECT * FROM mentions ORDER BY id').all()).toEqual(mentions);
    expect(db.prepare('SELECT start_sec, end_sec, text FROM summary_points ORDER BY id').all()).toEqual(points);
    expect(editRows()[0]).toMatchObject({ applied_at: expect.any(String), error: null });
    expect(mocks.notify.mock.calls[0]![0]).toContain('EP709 逐字稿修正 1 處');
  });

  it('marks an edit whose words are gone as failed and re-indexes nothing for it', async () => {
    fix(100, '沒有這句話', '改成這樣');
    expect(await applyPendingEdits(db, 709)).toEqual({ done: 0, missing: 1 });
    expect(mocks.embed).not.toHaveBeenCalled();
    expect(editRows()[0]).toMatchObject({ applied_at: null, error: '找不到要改的原文' });
  });

  it("doesn't apply edits to an episode that isn't on the site", async () => {
    fix();
    db.prepare(`UPDATE episodes SET status = 'failed' WHERE id = ?`).run(epId);
    await applyPendingEdits(db, 709);
    expect(editRows()[0]).toMatchObject({ error: '這集不在網站上' });
    expect(mocks.embed).not.toHaveBeenCalled();
  });

  it('waits on the queue behind a job already running for the episode', async () => {
    let release!: () => void;
    const running = enqueue('重新整理重點 EP709', () => new Promise<void>((r) => (release = r)));
    fix();
    const stop = watchEdits(db, enqueue, 60_000);
    await new Promise((r) => setTimeout(r, 20));
    expect(editRows()[0]).toMatchObject({ applied_at: null });
    expect(mocks.embed).not.toHaveBeenCalled();
    release();
    await running;
    await enqueue('after', async () => {});
    expect(editRows()[0]).toMatchObject({ applied_at: expect.any(String) });
    stop();
  });
});

describe('watchEdits', () => {
  it('gives up after three failed runs in a row, marking the edits failed', async () => {
    vi.useFakeTimers();
    try {
      mocks.embed.mockRejectedValue(new Error('OpenAI 500'));
      fix();
      const stop = watchEdits(db, enqueue, 1000);
      await vi.advanceTimersByTimeAsync(10);
      expect(mocks.notify).toHaveBeenCalledTimes(1);
      expect(editRows()[0]).toMatchObject({ applied_at: null, error: null });
      // Not retried before the wait is over
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mocks.embed).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(mocks.embed).toHaveBeenCalledTimes(3);
      expect(editRows()[0]).toMatchObject({ error: '套用失敗：OpenAI 500' });
      expect(mocks.notify).toHaveBeenCalledTimes(2);
      expect(mocks.notify.mock.calls[1]![0]).toContain('連續失敗 3 次');
      // Nothing pending any more, so nothing is retried
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      expect(mocks.embed).toHaveBeenCalledTimes(3);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('after a retranscription', () => {
  it('puts the edits back near where they were', async () => {
    fix();
    await applyPendingEdits(db, 709);
    // The new transcript has other boundaries and makes the same mistake
    const fresh = [seg(0, '開場'), seg(98, '今天吃交言肥腸'), seg(103, '真的很讚')];
    const back = putBackEdits(db, epId, 709, fresh);
    expect(back.segments.map((s) => s.text)).toEqual(['開場', '今天吃椒鹽肥腸', '真的很讚']);
    back.save();
    expect(editRows()[0]).toMatchObject({ seg_start: 98, old_text: '今天吃交言肥腸', new_text: '今天吃椒鹽肥腸', error: null });
    expect(back.message).toContain('套回 1/1 處');
  });

  it('runs inside a retranscribe before the summary, and reports what it could not put back', async () => {
    fix();
    fix(0, '第0句' + '內容'.repeat(20), '第零句' + '內容'.repeat(20));
    await applyPendingEdits(db, 709);
    mocks.notify.mockClear();
    mocks.transcribe.mockResolvedValue({ segments: [seg(99, '今天吃交言肥腸真的很讚')], billedSeconds: 200 });
    mocks.summarize.mockResolvedValue({ summary, costUsd: 0.3 });
    expect(await processEpisode(db, getEpisode(db, 709)!, { redoFrom: 'transcribe' })).toBe(true);
    // The summary read the corrected transcript
    expect(mocks.summarize.mock.calls[0]![1]).toEqual([seg(99, '今天吃椒鹽肥腸真的很讚')]);
    expect(fts('椒鹽肥腸')).toBe(1);
    expect(mocks.notify.mock.calls[0]![0]).toContain('套回 1/2 處');
    expect(mocks.notify.mock.calls[0]![0]).toContain('1 處找不到原文');
    expect(editRows()[1]).toMatchObject({ error: '重新轉錄後找不到原文' });
  });

  it('puts them back into a transcript given with --segments-file too', async () => {
    fix();
    await applyPendingEdits(db, 709);
    mocks.summarize.mockResolvedValue({ summary, costUsd: 0.3 });
    await processEpisode(db, getEpisode(db, 709)!, { redoFrom: 'transcribe', segments: [seg(100, '今天吃交言肥腸真的很讚')] });
    expect(JSON.parse(getEpisode(db, 709)!.segments_json!)).toEqual([seg(100, '今天吃椒鹽肥腸真的很讚')]);
  });
});

// ── web ────────────────────────────────────────────────────────────────────────

describe('admin access', () => {
  it('only lets the ids in ADMIN_USER_ID in', () => {
    vi.stubEnv('ADMIN_USER_ID', 'a1, a2');
    expect(isAdmin({ id: 'a2', name: '' })).toBe(true);
    expect(isAdmin({ id: 'b', name: '' })).toBe(false);
    expect(isAdmin(null)).toBe(false);
    vi.stubEnv('ADMIN_USER_ID', '');
    expect(isAdmin({ id: '', name: '' })).toBe(false);
    vi.unstubAllEnvs();
  });

  const post = (body: unknown) =>
    POST(new Request('http://localhost/api/admin/edits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  const edit = { episode: 709, edits: [{ index: 20, start: 100, oldText: '今天吃交言肥腸真的很讚', newText: '今天吃椒鹽肥腸真的很讚' }] };

  it('answers 404 to anyone not an admin, signed in or not', async () => {
    vi.stubEnv('ADMIN_USER_ID', 'admin');
    mocks.session.mockResolvedValue(null);
    expect((await post(edit)).status).toBe(404);
    mocks.session.mockResolvedValue({ user: { id: 'someone', name: 'x' } });
    expect((await post(edit)).status).toBe(404);
    expect(count('transcript_edits')).toBe(0);
    vi.unstubAllEnvs();
  });

  it('queues an admin edit, and refuses one made on a stale page', async () => {
    vi.stubEnv('ADMIN_USER_ID', 'admin');
    mocks.session.mockResolvedValue({ user: { id: 'admin', name: 'me' } });
    expect((await post(edit)).status).toBe(200);
    // The page now shows the pending text, so the same edit again doesn't match
    expect(adminEpisode(db, 709)!.segments[20]).toMatchObject({ text: '今天吃椒鹽肥腸真的很讚', pending: true });
    expect((await post(edit)).status).toBe(409);
    expect(editRows()).toHaveLength(1);
    vi.unstubAllEnvs();
  });

  it('names segments by index, since two can share a start, and refuses an empty one', async () => {
    vi.stubEnv('ADMIN_USER_ID', 'admin');
    mocks.session.mockResolvedValue({ user: { id: 'admin', name: 'me' } });
    const twin = [...segments.slice(0, 21), seg(100, '同一個開始時間的另一句'), ...segments.slice(21)];
    db.prepare('UPDATE episodes SET segments_json = ? WHERE id = ?').run(JSON.stringify(twin), epId);
    // The second of the pair, sent with the first's index: refused
    const second = { index: 20, start: 100, oldText: '同一個開始時間的另一句', newText: '同一個開始時間的另一句話' };
    expect((await post({ episode: 709, edits: [second] })).status).toBe(409);
    expect((await post({ episode: 709, edits: [{ ...second, index: 21 }] })).status).toBe(200);
    fix(100, '今天吃交言肥腸真的很讚', '今天吃椒鹽肥腸真的很讚');
    await applyPendingEdits(db, 709);
    const saved = JSON.parse(getEpisode(db, 709)!.segments_json!) as Segment[];
    expect(saved.slice(20, 22).map((s) => s.text)).toEqual(['今天吃椒鹽肥腸真的很讚', '同一個開始時間的另一句話']);
    const blank = { index: 0, start: 0, oldText: segments[0]!.text, newText: '  ' };
    expect((await post({ episode: 709, edits: [blank] })).status).toBe(400);
    vi.unstubAllEnvs();
  });
});
