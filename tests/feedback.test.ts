import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DB, openDb } from '@/lib/db.ts';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  moderate: vi.fn(),
  db: undefined as unknown,
}));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/lib/server-db.ts', () => ({ readDb: async () => mocks.db, writeDb: async () => mocks.db }));
vi.mock('openai', () => ({
  default: class {
    moderations = { create: mocks.moderate };
  },
}));

const { addFeedback, FEEDBACK_DAILY_LIMIT, getFeedback, gmailReplyUrl, isEmail, isSitePath, listFeedback, otherFeedback, updateFeedback } =
  await import('@/lib/feedback.ts');
const { purgeFeedbackContacts } = await import('../worker/feedback.ts');
const { stripAskLog } = await import('../worker/backup.ts');
const { compactDb } = await import('../worker/stats.ts');
const { POST: send } = await import('@/app/api/feedback/route.ts');
const { refuseCrossSite } = await import('@/lib/same-origin.ts');
const { POST: admin } = await import('@/app/api/admin/feedback/route.ts');

const post = (fn: (r: Request) => Promise<Response>, url: string, body: unknown, headers: Record<string, string> = {}) =>
  fn(
    new Request(`http://localhost${url}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );
const signIn = (id: string) => mocks.session.mockResolvedValue({ user: { id, name: 'x' } });

let db: DB;
beforeEach(() => {
  db = openDb(':memory:');
  mocks.db = db;
  mocks.session.mockReset();
  mocks.moderate.mockReset();
  mocks.moderate.mockResolvedValue({ results: [{ flagged: false }] });
  delete process.env.ADMIN_USER_ID;
});

const rows = () => db.prepare('SELECT * FROM feedback ORDER BY id').all() as Record<string, unknown>[];

describe('POST /api/feedback', () => {
  it('needs a login', async () => {
    mocks.session.mockResolvedValue(null);
    const res = await post(send, '/api/feedback', { kind: 'bug', body: '壞了' });
    expect(res.status).toBe(401);
    expect(rows()).toHaveLength(0);
  });

  it('saves feedback with and without an email', async () => {
    signIn('u1');
    const client = { ua: 'x'.repeat(500), width: 390, height: 844, theme: 'dark' };
    const a = await post(send, '/api/feedback', { kind: 'bug', body: '  時間戳不對  ', email: ' a@b.co ', page: '/ep/709', client });
    expect(a.status).toBe(200);
    expect(await a.json()).toMatchObject({ ok: true, id: 1, remaining: FEEDBACK_DAILY_LIMIT - 1 });
    const b = await post(send, '/api/feedback', { kind: 'idea', body: '想要訂閱', email: '' });
    expect(b.status).toBe(200);

    const [first, second] = rows();
    expect(first).toMatchObject({ user_id: 'u1', kind: 'bug', body: '時間戳不對', email: 'a@b.co', page: '/ep/709', status: 'new' });
    // The user agent is cut short
    expect(JSON.parse(first!.client_json as string)).toMatchObject({ width: 390, theme: 'dark', ua: 'x'.repeat(300) });
    expect(second).toMatchObject({ kind: 'idea', email: null, page: null, client_json: null });
  });

  it('refuses a bad email, an empty body and an unknown kind', async () => {
    signIn('u1');
    const bad = await post(send, '/api/feedback', { kind: 'bug', body: '壞了', email: 'not-an-email' });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/Email/);
    const empty = await post(send, '/api/feedback', { kind: 'bug', body: '   ' });
    expect(empty.status).toBe(400);
    expect((await empty.json()).error).toMatch(/內容/);
    expect((await post(send, '/api/feedback', { kind: 'praise', body: '讚' })).status).toBe(400);
    expect(rows()).toHaveLength(0);
  });

  it('drops a page or browser info that does not fit instead of refusing the words', async () => {
    for (const [i, page] of ['//evil.example', 'https://evil.example', '/\t/evil.example', 42].entries()) {
      signIn(`u${i}`);
      expect((await post(send, '/api/feedback', { kind: 'bug', body: `讚 ${i}`, page, client: { ua: 'x', width: -1 } })).status).toBe(200);
    }
    expect(rows().map((r) => [r.page, r.client_json])).toEqual(Array(4).fill([null, null]));
    // A long percent-encoded path is kept
    signIn('u9');
    const long = `/topic/food/${'%E7%BE%8E'.repeat(60)}`;
    expect((await post(send, '/api/feedback', { kind: 'bug', body: '長路徑', page: long })).status).toBe(200);
    expect(rows().at(-1)!.page).toBe(long);
  });

  it('refuses another origin and a non-JSON body', async () => {
    signIn('u1');
    expect((await post(send, '/api/feedback', { kind: 'bug', body: 'x' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(send, '/api/feedback', { kind: 'bug', body: 'x' }, { origin: 'null' })).status).toBe(403);
    // A Request drops a Host header, so the matching case goes through Headers of its own
    const req = (origin: string) => ({ headers: new Headers({ 'content-type': 'application/json', host: 'gooaye-notes.com', origin }) }) as Request;
    expect(refuseCrossSite(req('https://gooaye-notes.com'))).toBeNull();
    expect(refuseCrossSite(req('https://evil.example'))?.status).toBe(403);
    const res = await send(new Request('http://localhost/api/feedback', { method: 'POST', body: 'kind=bug' }));
    expect(res.status).toBe(415);
  });

  it('keeps to the daily limit and refuses the same words twice while the first is new', async () => {
    signIn('u1');
    expect((await post(send, '/api/feedback', { kind: 'other', body: '一' })).status).toBe(200);
    expect((await post(send, '/api/feedback', { kind: 'bug', body: '一' })).status).toBe(409);
    // Once an admin has marked it, the same words may come again (another day)
    updateFeedback(db, 1, { status: 'closed' });
    db.prepare(`UPDATE feedback SET created_at = '2020-01-01T00:00:00Z'`).run();
    expect((await post(send, '/api/feedback', { kind: 'other', body: '一' })).status).toBe(200);
    for (let i = 1; i < FEEDBACK_DAILY_LIMIT; i++) expect((await post(send, '/api/feedback', { kind: 'other', body: `第${i}則` })).status).toBe(200);
    expect((await post(send, '/api/feedback', { kind: 'other', body: '再一則' })).status).toBe(429);
    // Another account isn't affected
    signIn('u2');
    expect((await post(send, '/api/feedback', { kind: 'other', body: '再一則' })).status).toBe(200);
    // The limit is checked again inside the insert's transaction
    expect(addFeedback(db, 'u1', { kind: 'bug', body: '直接寫', email: null, page: null, client: null })).toEqual({ ok: false, reason: 'limit' });
  });

  it('refuses flagged content and lets it through when moderation is down', async () => {
    signIn('u1');
    mocks.moderate.mockResolvedValueOnce({ results: [{ flagged: true }] });
    expect((await post(send, '/api/feedback', { kind: 'other', body: '不當內容' })).status).toBe(400);
    mocks.moderate.mockRejectedValueOnce(new Error('down'));
    expect((await post(send, '/api/feedback', { kind: 'other', body: '普通內容' })).status).toBe(200);
    expect(rows()).toHaveLength(1);
  });
});

describe('admin', () => {
  const add = (user: string, body: string, email: string | null = null) => {
    const r = addFeedback(db, user, { kind: 'bug', body, email, page: '/', client: null });
    if (!r.ok) throw new Error(r.reason);
    return r.id;
  };

  it('lists new feedback first, oldest of them first, then the rest newest first', () => {
    const a = add('u1', 'a');
    const b = add('u2', 'b');
    const c = add('u3', 'c');
    const d = add('u4', 'd');
    updateFeedback(db, a, { status: 'closed' });
    updateFeedback(db, c, { status: 'replied' });
    expect(listFeedback(db).items.map((f) => f.id)).toEqual([b, d, c, a]);
    expect(listFeedback(db, { status: 'replied' }).items.map((f) => f.id)).toEqual([c]);
    expect(listFeedback(db, { kind: 'idea' })).toEqual({ items: [], more: false });
    // Paged
    expect(listFeedback(db, {}, 3)).toMatchObject({ more: true });
    expect(listFeedback(db, {}, 3).items.map((f) => f.id)).toEqual([b, d, c]);
    expect(listFeedback(db, {}, 3, 3)).toEqual({ items: [getFeedback(db, a)], more: false });
  });

  it('stamps resolved_at when it leaves new, keeps it between replied and closed, clears it going back', () => {
    const id = add('u1', 'a');
    expect(updateFeedback(db, id, { status: 'replied', note: '已回信' })).toBe(true);
    expect(getFeedback(db, id)).toMatchObject({ status: 'replied', note: '已回信' });
    db.prepare(`UPDATE feedback SET resolved_at = '2026-01-01T00:00:00Z'`).run();
    updateFeedback(db, id, { status: 'closed' });
    expect(getFeedback(db, id)).toMatchObject({ status: 'closed', resolvedAt: '2026-01-01T00:00:00Z' });
    updateFeedback(db, id, { status: 'new' });
    expect(getFeedback(db, id)).toMatchObject({ status: 'new', resolvedAt: null, note: '已回信' });
    expect(updateFeedback(db, 999, { status: 'closed' })).toBe(false);
  });

  it("finds the account's other feedback", () => {
    const a = add('u1', 'a');
    add('u2', 'b');
    const c = add('u1', 'c');
    expect(otherFeedback(db, getFeedback(db, a)!).map((f) => f.id)).toEqual([c]);
  });

  it('builds a Gmail reply with the address, the number and the words quoted', () => {
    const id = add('u1', '第一行\n第二行 a+b', 'a@b.co');
    const url = new URL(gmailReplyUrl(getFeedback(db, id)!)!);
    expect(url.host).toBe('mail.google.com');
    expect(url.searchParams.get('to')).toBe('a@b.co');
    expect(url.searchParams.get('su')).toBe(`Re: [股癌搜尋 #${id}] 你的問題回報`);
    expect(url.searchParams.get('body')).toContain('> 第一行\n> 第二行 a+b');
    expect(gmailReplyUrl(getFeedback(db, add('u1', 'no email'))!)).toBeNull();
    // A long one is cut short
    const long = add('u1', '字'.repeat(3000), 'a@b.co');
    expect(new URL(gmailReplyUrl(getFeedback(db, long)!)!).searchParams.get('body')).toContain(`${'字'.repeat(500)}…`);
  });

  it('only lets an admin change it', async () => {
    const id = add('u1', 'a');
    signIn('u1');
    expect((await post(admin, '/api/admin/feedback', { id, status: 'closed' })).status).toBe(404);
    process.env.ADMIN_USER_ID = 'boss';
    signIn('boss');
    expect((await post(admin, '/api/admin/feedback', { id, status: 'closed', note: '  看過了 ' })).status).toBe(200);
    expect(getFeedback(db, id)).toMatchObject({ status: 'closed', note: '看過了' });
    expect((await post(admin, '/api/admin/feedback', { id, note: '' })).status).toBe(200);
    expect(getFeedback(db, id)!.note).toBeNull();
    expect((await post(admin, '/api/admin/feedback', { id: 999, status: 'closed' })).status).toBe(404);
    expect((await post(admin, '/api/admin/feedback', { id, status: 'done' })).status).toBe(400);
  });
});

describe('helpers', () => {
  it('checks an email loosely and a path strictly', () => {
    expect(isEmail('a@b.co')).toBe(true);
    expect(isEmail('a@b')).toBe(false);
    expect(isEmail('a b@c.co')).toBe(false);
    expect(isSitePath('/ep/709')).toBe(true);
    expect(isSitePath('/')).toBe(true);
    expect(isSitePath('//evil.example')).toBe(false);
    expect(isSitePath('/\\evil.example')).toBe(false);
    expect(isSitePath('ep/709')).toBe(false);
    // URL parsing drops tabs and newlines, which would leave //evil.example
    expect(isSitePath('/\t/evil.example')).toBe(false);
    expect(isSitePath('/\n/evil.example')).toBe(false);
    expect(isSitePath('/ep/709?tab=tx')).toBe(true);
  });
});

describe('privacy', () => {
  it('forgets the email and account after FEEDBACK_KEEP_DAYS, keeping the words', () => {
    addFeedback(db, 'u1', { kind: 'bug', body: 'old', email: 'old@b.co', page: null, client: null });
    addFeedback(db, 'u2', { kind: 'bug', body: 'new', email: 'new@b.co', page: null, client: null });
    expect(purgeFeedbackContacts(db)).toBe(0);
    db.prepare(`UPDATE feedback SET created_at = '2020-01-01T00:00:00Z' WHERE body = 'old'`).run();
    expect(purgeFeedbackContacts(db)).toBe(1);
    expect(purgeFeedbackContacts(db)).toBe(0);
    expect(rows().map((r) => [r.body, r.user_id, r.email])).toEqual([
      ['old', null, null],
      ['new', 'u2', 'new@b.co'],
    ]);
  });

  it('leaves no purged email in the raw file, and none at all in a backup', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-'));
    const file = path.join(dir, 'app.db');
    const live = openDb(file);
    const insert = live.prepare(`INSERT INTO feedback (user_id, email, kind, body, created_at) VALUES (?, ?, 'other', ?, ?)`);
    for (let i = 0; i < 200; i++) insert.run(`secret-user-${i}`, `secret-${i}@mail.example`, `words ${i} `.repeat(50), '2020-01-01T00:00:00Z');
    insert.run('recent-user', 'recent@mail.example', 'recent', new Date().toISOString());
    const n = purgeFeedbackContacts(live);
    expect(n).toBe(200);
    expect(compactDb(live, n)).toBeNull();
    live.close();
    const raw = fs.readFileSync(file);
    expect(raw.includes('secret-1@mail.example')).toBe(false);
    expect(raw.includes('secret-user-1')).toBe(false);
    expect(raw.includes('recent@mail.example')).toBe(true);

    stripAskLog(file);
    const stripped = fs.readFileSync(file);
    expect(stripped.includes('recent@mail.example')).toBe(false);
    expect(stripped.includes('recent-user')).toBe(false);
    expect(stripped.includes('recent')).toBe(true); // the words stay
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
