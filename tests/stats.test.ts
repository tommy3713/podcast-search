import { beforeEach, describe, expect, it } from 'vitest';
import { type DB, openDb } from '@/lib/db';
import { getState, setState } from '../worker/repo.ts';
import { taipeiTime } from '../worker/schedule.ts';
import { askStats, digestDue, formatAsk, formatQuestions, formatStats, recentQuestions, rollupAskDaily, unanswered } from '../worker/stats.ts';

let db: DB;
beforeEach(() => {
  db = openDb(':memory:');
});

function ask(createdAt: string, user: string, outcome: string | null, extra: { ms?: number; cost?: number; q?: string } = {}) {
  db.prepare('INSERT INTO ask_log (user_id, question, created_at, outcome, ms, cost_usd) VALUES (?, ?, ?, ?, ?, ?)').run(
    user,
    extra.q ?? `q-${outcome}`,
    createdAt,
    outcome,
    extra.ms ?? null,
    extra.cost ?? null,
  );
}

describe('askStats', () => {
  it('counts outcomes, users, cost and the average time of finished answers', () => {
    ask('2026-11-01T02:00:00Z', 'u1', 'answered', { ms: 4000, cost: 0.01 });
    ask('2026-11-01T03:00:00Z', 'u1', 'no_source', { ms: 6000, cost: 0.02, q: '主委喜歡什麼顏色' });
    ask('2026-11-01T04:00:00Z', 'u2', 'quota');
    ask('2026-11-01T05:00:00Z', 'u2', 'timeout', { ms: 30000 });
    ask('2026-10-20T05:00:00Z', 'u3', 'answered'); // before the window

    const s = askStats(db, new Date('2026-10-30T00:00:00Z'));
    expect(s).toEqual({ asks: 4, users: 2, answered: 1, no_source: 1, moderated: 0, quota: 1, failed: 1, cost_usd: 0.03, avg_ms: 5000 });
    expect(unanswered(db, new Date('2026-10-30T00:00:00Z'))).toEqual([{ day: '2026-11-01', question: '主委喜歡什麼顏色' }]);
  });

  it('leaves out rows from before outcomes were recorded', () => {
    ask('2026-11-01T02:00:00Z', 'old', null);
    ask('2026-11-01T03:00:00Z', 'u1', 'answered');
    expect(askStats(db, new Date('2026-10-30T00:00:00Z'))).toMatchObject({ asks: 1, users: 1, answered: 1 });
    rollupAskDaily(db, '2026-11-02');
    expect(db.prepare('SELECT asks, users FROM ask_daily').all()).toEqual([{ asks: 1, users: 1 }]);
  });

  it('is all zeros on an empty week', () => {
    expect(askStats(db, new Date('2026-10-30T00:00:00Z'))).toMatchObject({ asks: 0, answered: 0, cost_usd: 0, avg_ms: null });
  });
});

describe('rollupAskDaily', () => {
  const daily = () => db.prepare('SELECT date, asks, users, answered, failed FROM ask_daily ORDER BY date').all();

  it('totals finished Taipei days and leaves today alone', () => {
    ask('2026-10-31T15:59:00Z', 'u1', 'answered'); // 23:59 on 10-31 Taipei
    ask('2026-10-31T16:01:00Z', 'u1', 'answered'); // 00:01 on 11-01 Taipei
    ask('2026-11-01T10:00:00Z', 'u2', 'error');
    ask('2026-11-02T01:00:00Z', 'u1', 'answered'); // today
    rollupAskDaily(db, '2026-11-02');
    expect(daily()).toEqual([
      { date: '2026-10-31', asks: 1, users: 1, answered: 1, failed: 0 },
      { date: '2026-11-01', asks: 2, users: 2, answered: 1, failed: 1 },
    ]);
  });

  it('is idempotent and never rewrites days older than four weeks', () => {
    ask('2026-10-01T02:00:00Z', 'u1', 'answered');
    ask('2026-11-01T02:00:00Z', 'u1', 'answered');
    rollupAskDaily(db, '2026-10-20');
    rollupAskDaily(db, '2026-11-02');
    rollupAskDaily(db, '2026-11-02');
    // The purge has since thinned out 10-01; its total must stay as first recorded
    db.prepare(`DELETE FROM ask_log WHERE created_at < '2026-10-02'`).run();
    rollupAskDaily(db, '2026-11-03');
    expect(daily()).toEqual([
      { date: '2026-10-01', asks: 1, users: 1, answered: 1, failed: 0 },
      { date: '2026-11-01', asks: 1, users: 1, answered: 1, failed: 0 },
    ]);
  });
});

describe('formatStats', () => {
  it('lists the questions without a source', () => {
    const text = formatStats(
      '上週問答',
      { asks: 3, users: 2, answered: 1, no_source: 1, moderated: 0, quota: 1, failed: 0, cost_usd: 0.031, avg_ms: 5200 },
      [{ day: '2026-11-01', question: '主委喜歡什麼顏色' }],
    );
    expect(text).toBe(
      [
        '📊 上週問答',
        '共 3 題・2 人',
        '✅ 有出處 1・❓ 沒出處 1・🚫 不當內容 0・⛔ 配額已滿 1・❌ 失敗 0',
        '成本 US$0.03・平均 5.2 秒',
        '',
        '❓ 沒有出處的問題：',
        '・11-01 主委喜歡什麼顏色',
      ].join('\n'),
    );
  });
});

describe('digestDue', () => {
  const t = (iso: string) => taipeiTime(new Date(iso));

  it('is due from Monday 09:00 Taipei until sent for that week', () => {
    expect(digestDue(t('2026-11-02T00:30:00Z'), null)).toBeNull(); // Mon 08:30
    expect(digestDue(t('2026-11-02T01:00:00Z'), null)).toBe('2026-11-02'); // Mon 09:00
    expect(digestDue(t('2026-11-02T01:30:00Z'), '2026-11-02')).toBeNull(); // already sent
  });

  it('catches up later in the week when Monday 09:00 was missed', () => {
    expect(digestDue(t('2026-11-03T02:00:00Z'), '2026-10-26')).toBe('2026-11-02'); // Tue 10:00
    expect(digestDue(t('2026-11-08T15:30:00Z'), '2026-10-26')).toBe('2026-11-02'); // Sun 23:30
  });

  it('remembers the last week in worker_state', () => {
    expect(getState(db, 'weekly_digest')).toBeNull();
    setState(db, 'weekly_digest', '2026-11-02');
    setState(db, 'weekly_digest', '2026-11-09');
    expect(getState(db, 'weekly_digest')).toBe('2026-11-09');
  });
});

describe('/questions', () => {
  it('lists the newest questions with time, user and outcome', () => {
    ask('2026-11-03T02:05:00Z', 'u1234567890', 'answered', { q: '主委推薦哪家拉麵' });
    ask('2026-11-03T03:10:00Z', 'u9876543210', 'no_source', { q: '主委喜歡什麼顏色' });
    const rows = recentQuestions(db, 10);
    expect(rows.map((r) => r.question)).toEqual(['主委喜歡什麼顏色', '主委推薦哪家拉麵']);
    const text = formatQuestions(rows);
    expect(text).toContain(`#${rows[0]!.id} 11-03 11:10 u98765 ❓ 主委喜歡什麼顏色`);
    expect(text).toContain(`#${rows[1]!.id} 11-03 10:05 u12345 ✅ 主委推薦哪家拉麵`);
  });

  it('says so when nobody has asked yet', () => {
    expect(formatQuestions([])).toBe('還沒有人問過問題（紀錄保留 30 天）');
  });

  it('shows one question with its answer, searches and cost', () => {
    db.prepare(
      `INSERT INTO ask_log (user_id, question, created_at, outcome, answer, cited, ms, cost_usd, tool_calls_json)
       VALUES ('u1234567890', '主委推薦哪家拉麵', '2026-11-03T02:05:00Z', 'answered', '推薦過一蘭 [1]', 1, 5400, 0.0062, ?)`,
    ).run(JSON.stringify([{ name: 'search_mentions', args: { category: '美食', keyword: '拉麵', since: null }, results: 3 }]));
    const id = (db.prepare('SELECT max(id) AS id FROM ask_log').get() as { id: number }).id;
    expect(formatAsk(db, id)).toBe(
      [
        `#${id} 11-03 10:05 u12345`,
        '問：主委推薦哪家拉麵',
        '✅ answered・引用 1・5.4 秒・US$0.0062',
        '搜尋：美食 拉麵（3 筆）',
        '',
        '答：推薦過一蘭 [1]',
      ].join('\n'),
    );
  });

  it('keeps a long answer within a Telegram message', () => {
    db.prepare(`INSERT INTO ask_log (user_id, question, outcome, answer) VALUES ('u1', 'q', 'answered', ?)`).run('長'.repeat(6000));
    const id = (db.prepare('SELECT max(id) AS id FROM ask_log').get() as { id: number }).id;
    expect(formatAsk(db, id).length).toBeLessThanOrEqual(4096);
    expect(formatAsk(db, 999999)).toBe('找不到 #999999（紀錄保留 30 天）');
  });
});
