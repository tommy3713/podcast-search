import { beforeEach, describe, expect, it } from 'vitest';
import { askDays, getAsk, goldenDraft, listAsks, parseAskFilter, searchSteps, userTag } from '@/lib/ask/log';
import { type DB, openDb } from '@/lib/db';

let db: DB;
beforeEach(() => {
  db = openDb(':memory:');
});

type Row = { at: string; user?: string; outcome?: string | null; q?: string; answer?: string; ms?: number; calls?: unknown };
function log(r: Row): number {
  return Number(
    db
      .prepare('INSERT INTO ask_log (user_id, question, created_at, outcome, answer, ms, tool_calls_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(r.user ?? 'u1234567890', r.q ?? 'q', r.at, r.outcome === undefined ? 'answered' : r.outcome, r.answer ?? null, r.ms ?? null, r.calls === undefined ? null : typeof r.calls === 'string' ? r.calls : JSON.stringify(r.calls))
      .lastInsertRowid,
  );
}

describe('parseAskFilter', () => {
  it('keeps what it recognises and drops the rest', () => {
    expect(
      parseAskFilter({ outcome: 'no_source', q: ' 拉麵 ', since: '2026-11-01', until: '2026-13-40', of: '42', flag: 'sound', x: 'y' }),
    ).toEqual({ outcome: 'no_source', q: '拉麵', since: '2026-11-01', of: 42, flag: 'sound' });
    expect(parseAskFilter({ outcome: 'bogus', flag: 'nope', of: "1' OR 1=1", q: '' })).toEqual({});
    expect(parseAskFilter({ outcome: ['failed', 'answered'] })).toEqual({ outcome: 'failed' });
  });
});

describe('listAsks', () => {
  it('filters by outcome, failures together, words in the question or answer, and Taipei days', () => {
    const a = log({ at: '2026-11-02T15:30:00Z', outcome: 'answered', q: '主委推薦哪家拉麵' }); // 11-02 23:30 Taipei
    const b = log({ at: '2026-11-02T16:30:00Z', outcome: 'no_source', q: '顏色', answer: '沒有提過100%' }); // 11-03 00:30
    const c = log({ at: '2026-11-03T02:00:00Z', outcome: 'timeout' });
    const d = log({ at: '2026-11-03T03:00:00Z', outcome: 'error' });
    const ids = (f: Parameters<typeof listAsks>[1]) => listAsks(db, f).rows.map((r) => r.id);
    expect(ids({})).toEqual([d, c, b, a]);
    expect(ids({ outcome: 'no_source' })).toEqual([b]);
    expect(ids({ outcome: 'failed' })).toEqual([d, c]);
    expect(ids({ q: '拉麵' })).toEqual([a]);
    expect(ids({ q: '100%' })).toEqual([b]); // LIKE wildcards are escaped
    expect(ids({ q: '0%沒' })).toEqual([]);
    expect(ids({ since: '2026-11-03' })).toEqual([d, c, b]);
    expect(ids({ until: '2026-11-02' })).toEqual([a]);
  });

  it("lists an account's questions by one of them, telling apart ids that start alike, and never shows the id", () => {
    const a1 = log({ at: '2026-11-03T02:00:00Z', user: '110169000000000000001' });
    log({ at: '2026-11-03T02:01:00Z', user: '110169000000000000002' }); // same first 6 characters
    const a2 = log({ at: '2026-11-03T02:02:00Z', user: '110169000000000000001' });
    const { rows, total } = listAsks(db, { of: a1 });
    expect(total).toBe(2);
    expect(rows.map((r) => r.id)).toEqual([a2, a1]);
    expect(rows[0]!.user).toBe(userTag('110169000000000000001'));
    expect(rows[0]!.user).not.toBe(userTag('110169000000000000002'));
    expect(rows[0]!.user).not.toContain('110169');
    expect(listAsks(db, { of: 999_999 }).total).toBe(0); // purged
  });

  it('flags and filters searches that hit a limit, matched nothing or went by sound, and slow answers', () => {
    const cut = log({ at: '2026-11-03T02:00:00Z', calls: [{ name: 'search_transcript', args: { query: '台積電' }, results: 8, cut: ['台積電'] }] });
    const none = log({ at: '2026-11-03T02:01:00Z', calls: [{ name: 'search_transcript', args: { query: 'Rivian' }, results: 8, unmatched: true }] });
    const sound = log({ at: '2026-11-03T02:02:00Z', calls: [{ name: 'search_transcript', args: { query: '椒鹽肥腸' }, results: 8, sound: ['椒鹽肥腸'] }] });
    const slow = log({ at: '2026-11-03T02:03:00Z', ms: 21_000, calls: [{ name: 'search_mentions', args: { category: '美食' }, results: 3 }] });
    log({ at: '2026-11-03T02:04:00Z', calls: 'not json' });
    expect(listAsks(db, { flag: 'cut' }).rows.map((r) => r.id)).toEqual([cut]);
    expect(listAsks(db, { flag: 'unmatched' }).rows.map((r) => r.id)).toEqual([none]);
    expect(listAsks(db, { flag: 'sound' }).rows.map((r) => r.id)).toEqual([sound]);
    expect(listAsks(db, { flag: 'slow' }).rows.map((r) => r.id)).toEqual([slow]);
    const flags = Object.fromEntries(listAsks(db, {}).rows.map((r) => [r.id, r.flags]));
    expect([flags[cut], flags[none], flags[sound], flags[slow]]).toEqual([['cut'], ['unmatched'], ['sound'], []]);
  });

  it('pages newest first by id, unaffected by questions logged in between', () => {
    const ids = Array.from({ length: 5 }, (_, i) => log({ at: `2026-11-03T02:0${i}:00Z` }));
    const first = listAsks(db, {}, null, 2);
    expect(first.rows.map((r) => r.id)).toEqual([ids[4], ids[3]]);
    expect(first.total).toBe(5);
    log({ at: '2026-11-03T03:00:00Z' });
    const second = listAsks(db, {}, first.next, 2);
    expect(second.rows.map((r) => r.id)).toEqual([ids[2], ids[1]]);
    const last = listAsks(db, {}, second.next, 2);
    expect(last.rows.map((r) => r.id)).toEqual([ids[0]]);
    expect(last.next).toBeNull();
  });
});

describe('getAsk', () => {
  it('reads one question with its searches, tokens and neighbours', () => {
    const older = log({ at: '2026-11-03T02:00:00Z' });
    const id = log({
      at: '2026-11-03T02:05:00Z',
      q: '主委推薦哪家拉麵',
      answer: 'EP700：推薦過一蘭 [1]',
      calls: [
        { name: 'search_mentions', args: { category: '美食', keyword: '拉麵', since: null }, results: 3 },
        { name: 'search_transcript', args: '{"query": 拉麵', results: 0 },
      ],
    });
    db.prepare('UPDATE ask_log SET input_tokens = 1200, output_tokens = 300, hits = 11 WHERE id = ?').run(id);
    const a = getAsk(db, id)!;
    expect(a).toMatchObject({ question: '主委推薦哪家拉麵', user: userTag('u1234567890'), inputTokens: 1200, outputTokens: 300, hits: 11, newer: null, older });
    expect(a.steps).toEqual([
      { tool: 'mentions', what: '美食・拉麵', query: null, results: 3, cut: [], unmatched: false, sound: [] },
      { tool: 'transcript', what: '{"query": 拉麵', query: null, results: 0, cut: [], unmatched: false, sound: [] },
    ]);
    expect(getAsk(db, older)!.newer).toBe(id);
    expect(getAsk(db, 999_999)).toBeNull();
  });

  it('reads tool calls that are missing or not a list as no searches', () => {
    expect(searchSteps(null)).toEqual([]);
    expect(searchSteps('{"a":1}')).toEqual([]);
    expect(searchSteps('[')).toEqual([]);
    expect(searchSteps('[null, 3]')).toEqual([]);
  });
});

describe('askDays', () => {
  it('returns every finished day before today, oldest first, with a gap for a day nobody asked on', () => {
    const add = db.prepare(
      `INSERT INTO ask_daily (date, asks, users, answered, no_source, moderated, quota, failed, cost_usd, avg_ms) VALUES (?, ?, 1, 1, 0, 0, 0, 0, 0, NULL)`,
    );
    for (const [d, n] of [['2026-10-30', 9], ['2026-11-01', 3], ['2026-11-03', 2], ['2026-11-04', 7]] as const) add.run(d, n);
    expect(askDays(db, 3, '2026-11-04').map((d) => [d.date, d.day?.asks ?? null])).toEqual([
      ['2026-11-01', 3],
      ['2026-11-02', null],
      ['2026-11-03', 2],
    ]);
  });
});

describe('goldenDraft', () => {
  const steps = searchSteps(
    JSON.stringify([
      { name: 'search_transcript', args: { query: '台積電・聯發科', episode: 700 }, results: 8 },
      { name: 'search_transcript', args: '{"query": 拉麵', results: 0 },
      { name: 'search_mentions', args: { category: '股票', keyword: '台積電' }, results: 3 },
      { name: 'search_transcript', args: { query: '台積電・聯發科' }, results: 8 },
    ]),
  );
  const draft = (outcome: string | null, answer: string | null) => goldenDraft({ outcome, question: '問', answer, steps });

  it("takes episodes from the lines' labels only, and transcript queries as the model sent them", () => {
    const d = draft('answered', 'EP709｜他說「先觀望」[1]，跟 EP650 那次不同。\n- EP700・EP702｜提到法說會 [2][3]\n總之如此。')!;
    expect(JSON.parse(d.line)).toEqual({
      id: 'detail-XX',
      type: 'detail',
      question: '問',
      expect_eps: [709, 702, 700],
      queries: ['台積電・聯發科'],
      points: [],
      must_not: [],
      refuse: false,
    });
    expect(d.partial).toBe(false);
  });

  it('says so when a label named only some of the episodes a line cites', () => {
    const d = draft('answered', '- EP700・EP701・EP702 等 5 集｜很多集都提過 [1][2][3][4][5]')!;
    expect(JSON.parse(d.line).expect_eps).toEqual([702, 701, 700]);
    expect(d.partial).toBe(true);
  });

  it('makes an answer without a source a not_found question, and offers nothing for one never answered', () => {
    const d = draft('no_source', '節目裡沒有提到。')!;
    expect(JSON.parse(d.line)).toMatchObject({ id: 'nf-XX', type: 'not_found', expect_eps: [], refuse: true });
    for (const o of ['timeout', 'error', 'moderated', 'quota', 'aborted', null]) expect(draft(o, null)).toBeNull();
  });
});
