import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DB } from '@/lib/db.ts';

// 😀 / 🙁 under an answer on /ask, and where the admin and Telegram read them back
const mocks = vi.hoisted(() => ({ session: vi.fn(), db: undefined as unknown }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/lib/server-db.ts', () => ({ readDb: async () => mocks.db, writeDb: async () => mocks.db }));

const { openDb } = await import('@/lib/db.ts');
const { logAsk, rateAsk } = await import('@/lib/ask/quota.ts');
const { askDays, askStats, getAsk, listAsks, parseAskFilter } = await import('@/lib/ask/log.ts');
const { parseReasons } = await import('@/lib/ask/rating.ts');
const { disliked, formatAsk, formatQuestions, formatStats, recentQuestions, rollupAskDaily } = await import('../worker/stats.ts');
const { POST } = await import('@/app/api/ask/rating/route.ts');

let db: DB;
const at = new Date('2026-11-16T04:00:00Z');

beforeEach(() => {
  db = openDb(':memory:');
  mocks.db = db;
});

const ask = (userId = 'u1', outcome: 'answered' | 'no_source' | 'timeout' = 'answered', question = '台積電說了什麼？') =>
  logAsk(db, { userId, question, outcome, answer: 'EP709｜說了 [1]', cited: 1 })!;
const row = (id: number) => db.prepare('SELECT rating, rating_reasons, rating_note, rated_at FROM ask_log WHERE id = ?').get(id);
const post = (body: unknown) =>
  POST(new Request('http://localhost/api/ask/rating', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const signIn = (id: string) => mocks.session.mockResolvedValue({ user: { id, name: 'x' } });

describe('rateAsk', () => {
  it("keeps a rating on the listener's own answer, replacing the last one whole", () => {
    const id = ask();
    expect(rateAsk(db, 'u1', id, { rating: 'bad' }, at)).toEqual({ ok: true });
    expect(row(id)).toEqual({ rating: 'bad', rating_reasons: null, rating_note: null, rated_at: '2026-11-16T04:00:00Z' });
    // the reasons come after the click, in the page's order whatever order they were sent in
    rateAsk(db, 'u1', id, { rating: 'bad', reasons: ['incomplete', 'wrong_episode', 'incomplete'], note: '  是夜市那集  ' }, at);
    expect(row(id)).toMatchObject({ rating: 'bad', rating_reasons: '["wrong_episode","incomplete"]', rating_note: '是夜市那集' });
    // changed to 😀: why it was 🙁 goes, and 😀 takes no reasons
    rateAsk(db, 'u1', id, { rating: 'good', reasons: ['other'], note: 'x' }, at);
    expect(row(id)).toMatchObject({ rating: 'good', rating_reasons: null, rating_note: null });
  });

  it("refuses someone else's answer, a missing one and one never answered", () => {
    const id = ask();
    expect(rateAsk(db, 'u2', id, { rating: 'good' })).toEqual({ ok: false, reason: 'missing' });
    expect(rateAsk(db, 'u1', 999, { rating: 'good' })).toEqual({ ok: false, reason: 'missing' });
    expect(rateAsk(db, 'u1', ask('u1', 'timeout'), { rating: 'bad' })).toEqual({ ok: false, reason: 'unfinished' });
    expect(row(id)).toMatchObject({ rating: null });
    // an answer that found nothing can be rated: it's the one most worth hearing about
    expect(rateAsk(db, 'u1', ask('u1', 'no_source'), { rating: 'bad' }).ok).toBe(true);
  });

  it('is unavailable on a database the migration has not reached', () => {
    const old = openDb(':memory:');
    old.exec('ALTER TABLE ask_log DROP COLUMN rating');
    expect(rateAsk(old, 'u1', 1, { rating: 'good' })).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('reads reasons back leniently', () => {
    expect(parseReasons('["other","nope","wrong_episode"]')).toEqual(['wrong_episode', 'other']);
    expect(parseReasons('{"x":1}')).toEqual([]);
    expect(parseReasons('not json')).toEqual([]);
    expect(parseReasons(null)).toEqual([]);
  });
});

describe('POST /api/ask/rating', () => {
  it('needs a login and a same-origin JSON body', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await post({ id: ask(), rating: 'good' })).status).toBe(401);
    const form = new Request('http://localhost/api/ask/rating', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    expect((await POST(form)).status).toBe(415);
  });

  it('rates, and can be sent with no reason and no note', async () => {
    signIn('u1');
    const id = ask();
    expect((await post({ id, rating: 'bad' })).status).toBe(200);
    expect((await post({ id, rating: 'bad', reasons: [], note: null })).status).toBe(200);
    expect(row(id)).toMatchObject({ rating: 'bad', rating_reasons: null, rating_note: null });
    expect((await post({ id, rating: 'bad', reasons: ['off_topic'], note: '問的是 2024 年' })).status).toBe(200);
    expect(row(id)).toMatchObject({ rating_reasons: '["off_topic"]', rating_note: '問的是 2024 年' });
  });

  it('refuses what it does not know, a long note and an answer that is not theirs', async () => {
    signIn('u1');
    const id = ask();
    const meh = await post({ id, rating: 'meh' });
    expect(meh.status).toBe(400);
    // only a note that's too long is the listener's to fix
    expect(((await meh.json()) as { error: string }).error).toBe('評分沒有送出，請重新整理頁面再試。');
    expect(((await (await post({ id, rating: 'bad', note: '字'.repeat(201) })).json()) as { error: string }).error).toBe('補充說明請在 200 字以內');
    expect((await post({ id, rating: 'bad', reasons: ['bogus'] })).status).toBe(400);
    expect((await post({ id, rating: 'bad', extra: 1 })).status).toBe(400);
    expect((await post({ id, rating: 'bad', note: '字'.repeat(201) })).status).toBe(400);
    expect((await post({ id, rating: 'bad', note: '字'.repeat(200) })).status).toBe(200);
    expect((await post({ id: ask('u2'), rating: 'good' })).status).toBe(404);
    expect((await post({ id: ask('u1', 'timeout'), rating: 'good' })).status).toBe(409);
  });
});

describe('ratings in the log', () => {
  function rated() {
    const good = ask('u1', 'answered', '好的回答');
    const bad = ask('u2', 'no_source', '不好的回答');
    const none = ask('u3', 'answered', '沒評分的回答');
    ask('u3', 'timeout', '逾時');
    rateAsk(db, 'u1', good, { rating: 'good' });
    rateAsk(db, 'u2', bad, { rating: 'bad', reasons: ['wrong_episode'], note: '應該是 EP500' });
    return { good, bad, none };
  }

  it('counts them in the totals and the nightly rollup', () => {
    rated();
    // out of the finished answers only: a broad answer that timed out can't be rated
    logAsk(db, { userId: 'u1', question: '好的回答', outcome: 'timeout', retryOf: 1 });
    expect(askStats(db, new Date(0))).toMatchObject({ asks: 4, good: 1, bad: 1, rateable: 3 });
    const today = new Date(Date.now() + 8 * 3600_000 + 86_400_000).toISOString().slice(0, 10);
    rollupAskDaily(db, today);
    expect(db.prepare('SELECT SUM(asks) AS asks, SUM(good) AS good, SUM(bad) AS bad FROM ask_daily').get()).toEqual({ asks: 4, good: 1, bad: 1 });
    expect(askDays(db, 3, today).filter((d) => d.day).map((d) => [d.day!.good, d.day!.bad])).toEqual([[1, 1]]);
  });

  it('filters the admin list by rating, and finds the answers nobody rated', () => {
    const { good, bad, none } = rated();
    const ids = (q: Record<string, string>) => listAsks(db, parseAskFilter(q)).rows.map((r) => r.id);
    expect(ids({ rating: 'good' })).toEqual([good]);
    expect(ids({ rating: 'bad' })).toEqual([bad]);
    expect(ids({ rating: 'none' })).toEqual([none]);
    expect(parseAskFilter({ rating: 'meh' })).toEqual({});
    expect(listAsks(db, {}).rows.find((r) => r.id === bad)).toMatchObject({ rating: 'bad', reasons: ['wrong_episode'], hasNote: true });
    expect(getAsk(db, bad)).toMatchObject({ rating: 'bad', reasons: ['wrong_episode'], ratingNote: '應該是 EP500' });
    expect(getAsk(db, none)).toMatchObject({ rating: null, reasons: [], ratingNote: null });
  });

  it('shows them in Telegram: the totals, the 🙁 answers, /questions and one question', () => {
    const { bad } = rated();
    const since = new Date(0);
    const text = formatStats('最近 7 天問答', askStats(db, since), [], disliked(db, since));
    expect(text).toContain('評分 😀 1・🙁 1（3 個回答中）');
    expect(text).toContain(`・#${bad} `);
    expect(text).toContain('不好的回答（找錯集數） 📝');
    expect(formatQuestions(recentQuestions(db, 10))).toContain('❓ 🙁 不好的回答');
    expect(formatAsk(db, bad)).toContain('評分：🙁 找錯集數\n聽眾說：應該是 EP500');
  });

  it('reads a snapshot from before ratings', () => {
    const old = openDb(':memory:');
    old.exec('ALTER TABLE ask_log DROP COLUMN rating');
    const id = logAsk(old, { userId: 'u1', question: 'q', outcome: 'answered' })!;
    expect(askStats(old, new Date(0))).toMatchObject({ good: 0, bad: 0 });
    expect(listAsks(old, { rating: 'bad' }).rows).toEqual([]);
    expect(listAsks(old, { rating: 'none' }).rows.map((r) => r.id)).toEqual([id]);
    expect(getAsk(old, id)).toMatchObject({ rating: null });
    expect(disliked(old, new Date(0))).toEqual([]);
    expect(formatQuestions(recentQuestions(old, 5))).toContain('✅ q');
  });
});
