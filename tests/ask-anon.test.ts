import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DB } from '@/lib/db.ts';

// Questions without a login: a browser's id per day, its network's cap, and the routes signed out
const mocks = vi.hoisted(() => ({ session: vi.fn(), db: undefined as unknown }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/lib/server-db.ts', () => ({ readDb: async () => mocks.db, writeDb: async () => mocks.db }));

const { openDb } = await import('@/lib/db.ts');
const { addressKey, anonAllowed, anonCookie, anonToken, anonVisitor, clientAddress, cookieValue, isAnon, newAnonToken } = await import('@/lib/ask/anon.ts');
const quota = await import('@/lib/ask/quota.ts');
const { ADDRESS_DAILY_LIMIT, ANON_DAILY_LIMIT, ANON_SITE_DAILY_LIMIT, SITE_DAILY_LIMIT, USER_DAILY_LIMIT, anonUsed, logAsk, logQuotaRejection, refundQuota, remaining, takeQuota, taipeiDate } = quota;
const { askStats, listAsks, parseAskFilter, shortUser, userTag } = await import('@/lib/ask/log.ts');
const { stripAskLog } = await import('../worker/backup.ts');
const { POST: ask } = await import('@/app/api/ask/route.ts');
const { POST: rate } = await import('@/app/api/ask/rating/route.ts');

const TOKEN_A = 'a'.repeat(32);
const TOKEN_B = 'b'.repeat(32);
const today = () => taipeiDate();
let db: DB;
beforeEach(() => {
  db = openDb(':memory:');
  mocks.db = db;
  mocks.session.mockResolvedValue(null);
  vi.stubEnv('NEXTAUTH_SECRET', 'test-secret');
});
afterEach(() => vi.unstubAllEnvs());

const usage = (key: string, date: string, count: number) => db.prepare('INSERT INTO ask_usage (user_id, date, count) VALUES (?, ?, ?)').run(key, date, count);
const count = (key: string) => (db.prepare('SELECT count FROM ask_usage WHERE user_id = ? AND date = ?').get(key, today()) as { count: number } | undefined)?.count ?? 0;

describe('addressKey', () => {
  it('keeps an IPv4 address and takes the /64 of an IPv6 one', () => {
    expect(addressKey('203.0.113.7')).toBe('203.0.113.7');
    expect(addressKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    // Another address in the same /64, written short, is the same network
    expect(addressKey('2001:0db8:0001:0002::1')).toBe('2001:db8:1:2::/64');
    expect(addressKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(addressKey('2001:db8:1:3::1')).not.toBe(addressKey('2001:db8:1:2::1'));
    expect(addressKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('refuses anything that is not an address', () => {
    expect(addressKey('')).toBeNull();
    expect(addressKey('localhost')).toBeNull();
    expect(addressKey('203.0.113.7, 10.0.0.1')).toBeNull();
  });
});

describe('clientAddress', () => {
  const h = (cf?: string) => new Headers(cf ? { 'cf-connecting-ip': cf } : {});

  it("reads Cloudflare's header", () => {
    expect(clientAddress(h('203.0.113.7'))).toBe('203.0.113.7');
  });

  it('counts every local request as one address, and none live without the header', () => {
    expect(clientAddress(h())).toBe('127.0.0.1');
    vi.stubEnv('APP_ENV', 'production');
    expect(clientAddress(h())).toBeNull();
    expect(anonAllowed(clientAddress(h()))).toBe(false);
    // X-Forwarded-For is set by whoever sends it, so it is never read
    expect(clientAddress(new Headers({ 'x-forwarded-for': '203.0.113.7' }))).toBeNull();
  });
});

describe('the cookie', () => {
  it('holds a random token, read back only in the form the site makes', () => {
    const t = newAnonToken();
    expect(anonToken(t)).toBe(t);
    expect(newAnonToken()).not.toBe(t);
    expect(anonToken('x')).toBeNull();
    expect(anonToken(undefined)).toBeNull();
    expect(cookieValue(new Headers({ cookie: `a=1; gooaye_anon=${t}; b=2` }))).toBe(t);
    expect(anonCookie(t)).toMatch(/HttpOnly; SameSite=Lax$/);
    vi.stubEnv('APP_ENV', 'production');
    expect(anonCookie(t)).toMatch(/; Secure$/);
  });
});

describe('anonVisitor', () => {
  it("is the browser's for the day, whatever its address, and never holds either", () => {
    const v = anonVisitor(TOKEN_A, '203.0.113.7', '2026-11-18')!;
    expect(v.id).toMatch(/^anon:[0-9a-f]{16}$/);
    expect(v.address).toMatch(/^anonip:[0-9a-f]{16}$/);
    expect(v.id).not.toContain('aaaa');
    expect(anonVisitor(TOKEN_A, '198.51.100.1', '2026-11-18')!.id).toBe(v.id); // Wi-Fi to mobile
    expect(anonVisitor(TOKEN_A, '203.0.113.7', '2026-11-19')!.id).not.toBe(v.id);
    expect(anonVisitor(TOKEN_B, '203.0.113.7', '2026-11-18')).toEqual({ id: expect.not.stringMatching(v.id), address: v.address });
    expect(isAnon(v.id)).toBe(true);
    expect(isAnon(v.address)).toBe(false);
    expect(isAnon('109876543210')).toBe(false);
  });

  it('is null without a token, an address or a secret', () => {
    expect(anonVisitor(null, '203.0.113.7', '2026-11-18')).toBeNull();
    expect(anonVisitor(TOKEN_A, null, '2026-11-18')).toBeNull();
    vi.stubEnv('NEXTAUTH_SECRET', '');
    expect(anonVisitor(TOKEN_A, '203.0.113.7', '2026-11-18')).toBeNull();
    expect(anonAllowed('203.0.113.7')).toBe(false);
  });
});

describe('quota without a login', () => {
  const visitor = (token: string, ip = '203.0.113.7') => anonVisitor(token, ip, today())!;

  it('gives a browser ANON_DAILY_LIMIT a day, charging its network too', () => {
    const v = visitor(TOKEN_A);
    expect(remaining(db, v.id)).toBe(ANON_DAILY_LIMIT);
    for (let i = ANON_DAILY_LIMIT - 1; i >= 0; i--) expect(takeQuota(db, v.id, undefined, v.address)).toEqual({ ok: true, remaining: i });
    expect(takeQuota(db, v.id, undefined, v.address)).toEqual({ ok: false, reason: 'user' });
    expect(count(v.address)).toBe(ANON_DAILY_LIMIT);
    refundQuota(db, v.id, undefined, v.address);
    expect([count(v.id), count(v.address)]).toEqual([ANON_DAILY_LIMIT - 1, ANON_DAILY_LIMIT - 1]);
    // Without its network's key a visitor can't ask
    expect(takeQuota(db, visitor(TOKEN_B).id)).toEqual({ ok: false, reason: 'address' });
  });

  it("stops a network at ADDRESS_DAILY_LIMIT however many cookies it clears, and not another's", () => {
    const v = visitor(TOKEN_A);
    usage(v.address, today(), ADDRESS_DAILY_LIMIT);
    expect(takeQuota(db, v.id, undefined, v.address)).toEqual({ ok: false, reason: 'address' });
    const elsewhere = visitor(TOKEN_A, '198.51.100.1');
    expect(takeQuota(db, elsewhere.id, undefined, elsewhere.address)).toEqual({ ok: true, remaining: ANON_DAILY_LIMIT - 1 });
  });

  it('stops visitors at ANON_SITE_DAILY_LIMIT, and not accounts', () => {
    for (let i = 0; i < ANON_SITE_DAILY_LIMIT / 2; i++) usage(`anon:${String(i).padStart(16, '0')}`, today(), 2);
    usage('u-heavy', today(), 20); // an account's questions don't count toward it
    expect(anonUsed(db, today())).toBe(ANON_SITE_DAILY_LIMIT);
    const v = visitor(TOKEN_A);
    expect(takeQuota(db, v.id, undefined, v.address)).toEqual({ ok: false, reason: 'anon_site' });
    expect(takeQuota(db, 'u1')).toEqual({ ok: true, remaining: USER_DAILY_LIMIT - 1 });
  });

  it("counts a visitor's question once toward the site's cap", () => {
    const v = visitor(TOKEN_A);
    expect(takeQuota(db, v.id, undefined, v.address).ok).toBe(true);
    usage('u-heavy', today(), SITE_DAILY_LIMIT - 2); // with the visitor's, one short of the cap
    expect(takeQuota(db, 'u1').ok).toBe(true);
    expect(takeQuota(db, 'u2')).toEqual({ ok: false, reason: 'site' });
  });

  it("doesn't log a visitor's rejections, whose ids cost nothing to make", () => {
    logQuotaRejection(db, visitor(TOKEN_A).id, 'q');
    logQuotaRejection(db, 'u1', 'q');
    expect(db.prepare('SELECT user_id FROM ask_log').all()).toEqual([{ user_id: 'u1' }]);
  });
});

describe('/api/ask signed out', () => {
  const post = (body: unknown, cookie?: string, cf = '203.0.113.7') =>
    ask(
      new Request('http://localhost/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': cf, ...(cookie ? { cookie: `gooaye_anon=${cookie}` } : {}) },
        body: JSON.stringify(body),
      }),
    );

  it('asks for a login when there is no address to count by', async () => {
    vi.stubEnv('APP_ENV', 'production');
    const res = await ask(new Request('http://localhost/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"question":"q"}' }));
    expect(res.status).toBe(401);
  });

  it('keeps 擴大搜尋 for accounts', async () => {
    const res = await post({ retryOf: 1 }, TOKEN_A);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toContain('登入');
  });

  it('says signing in gets more once their questions are used up, with the reason', async () => {
    const v = anonVisitor(TOKEN_A, '203.0.113.7', today())!;
    usage(v.id, today(), ANON_DAILY_LIMIT);
    const res = await post({ question: '主委玩過哪些手遊？' }, TOKEN_A);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: `今天免登入的 ${ANON_DAILY_LIMIT} 題用完了，登入就能每天問 ${USER_DAILY_LIMIT} 題。`, reason: 'user' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('gives a browser without the cookie a token', async () => {
    usage(anonVisitor(TOKEN_A, '203.0.113.7', today())!.address, today(), ADDRESS_DAILY_LIMIT);
    const res = await post({ question: 'q' });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { reason: string }).reason).toBe('address');
    expect(res.headers.get('set-cookie')).toMatch(/^gooaye_anon=[0-9a-f]{32}; Path=\//);
  });
});

describe('rating signed out', () => {
  const post = (id: number, token: string, cf = '203.0.113.7') =>
    rate(
      new Request('http://localhost/api/ask/rating', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': cf, cookie: `gooaye_anon=${token}` },
        body: JSON.stringify({ id, rating: 'good' }),
      }),
    );
  const log = (userId: string) =>
    logAsk(db, { userId, question: 'q', outcome: 'answered', answer: 'a [1]', cited: 1, ms: 1, toolCalls: [], inputTokens: 0, outputTokens: 0, costUsd: 0 })!;

  it("rates the browser's own answer that day, from any network, and not another's", async () => {
    const mine = log(anonVisitor(TOKEN_A, '203.0.113.7', today())!.id);
    expect((await post(mine, TOKEN_A)).status).toBe(200);
    expect((await post(mine, TOKEN_A, '198.51.100.1')).status).toBe(200);
    // Another browser behind the same address (a mobile network's shared IPv4)
    expect((await post(mine, TOKEN_B)).status).toBe(404);
    expect((await post(log('u1'), TOKEN_A)).status).toBe(404);
  });
});

describe('the log', () => {
  it('tags visitors, filters by who asked and counts them apart', () => {
    const v = anonVisitor(TOKEN_A, '203.0.113.7', today())!;
    const base = { question: 'q', outcome: 'answered' as const, answer: 'a', cited: 1, ms: 1, toolCalls: [], inputTokens: 0, outputTokens: 0, costUsd: 0.01 };
    logAsk(db, { ...base, userId: v.id });
    logAsk(db, { ...base, userId: 'u1' });
    // A full day (today, inside the span askStats reads) and one long gone
    usage(`anon:${'0'.repeat(16)}`, today(), ANON_SITE_DAILY_LIMIT);
    usage(`anon:${'0'.repeat(16)}`, '2020-01-01', ANON_SITE_DAILY_LIMIT);
    usage(v.address, today(), 5); // a network's count is not a visitor's
    expect(userTag(v.id)).toMatch(/^未登入 [0-9a-f]{6}$/);
    expect(userTag('u1')).toMatch(/^[0-9a-f]{6}$/);
    expect(shortUser(v.id)).toMatch(/^未登入[0-9a-f]{4}$/);
    expect(listAsks(db, parseAskFilter({ who: 'anon' })).rows.map((r) => r.user)).toEqual([userTag(v.id)]);
    expect(listAsks(db, parseAskFilter({ who: 'account' })).rows.map((r) => r.user)).toEqual([userTag('u1')]);
    const s = askStats(db, new Date(Date.now() - 86_400_000));
    expect([s.asks, s.anon, s.anonFull, s.anonFullCut]).toEqual([2, 1, 1, false]);
    expect(askStats(db, new Date(Date.now() - 30 * 86_400_000)).anonFullCut).toBe(true);
  });

  it("leaves visitors' and networks' counts out of a backup", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anon-')), 'b.db');
    const b = openDb(file);
    const v = anonVisitor(TOKEN_A, '203.0.113.7', today())!;
    for (const k of [v.id, v.address, 'u1']) b.prepare('INSERT INTO ask_usage (user_id, date, count) VALUES (?, ?, 1)').run(k, today());
    b.close();
    stripAskLog(file);
    const after = openDb(file, { readonly: true });
    expect(after.prepare('SELECT user_id FROM ask_usage').all()).toEqual([{ user_id: 'u1' }]);
    after.close();
  });
});
