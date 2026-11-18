import { beforeEach, describe, expect, it } from 'vitest';
import { type DB, openDb } from '@/lib/db';
import { ON_THIS_DAY_KEYS, ON_THIS_DAY_STOCKS, ON_THIS_DAY_YEARS, onThisDay } from '@/lib/on-this-day';

let db: DB;
beforeEach(() => {
  db = openDb(':memory:');
});

// An episode released at 15:00 Taipei on `date`
function add(no: number, date: string, opts: { status?: string; summary?: object } = {}) {
  const summary = opts.summary ?? {
    line: `EP${no} 的一句話`,
    keys: [1, 2, 3, 4].map((i) => ({ t: i * 60.7, text: `重點${i}` })),
    chapters: [],
    stocks: ['台積電', '輝達', '台積電', '蘋果', 'AMD', 'Google'].map((name) => ({ name, code: null, note: '' })),
    mentions: [],
  };
  db.prepare(
    `INSERT INTO episodes (episode_no, guid, title, published_at, audio_url, status, summary_json) VALUES (?, ?, '⭐', ?, 'https://x', ?, ?)`,
  ).run(no, `g${no}`, `${date}T07:00:00.000Z`, opts.status ?? 'done', JSON.stringify(summary));
}

const picks = (today: string) => onThisDay(db, today).map((x) => [x.yearsAgo, x.no]);

describe('onThisDay', () => {
  it('takes, for each earlier year, the episode released nearest to the day', () => {
    add(1, '2024-11-13');
    add(2, '2024-11-16');
    add(3, '2025-11-15');
    add(4, '2025-11-19');
    add(5, '2026-11-18');
    expect(picks('2026-11-18')).toEqual([
      [1, 4],
      [2, 2],
    ]);
  });

  it('shows the newest three years that have one, skipping a year without', () => {
    expect(ON_THIS_DAY_YEARS).toBe(3);
    add(1, '2025-11-18');
    add(2, '2023-11-18');
    add(3, '2022-11-18');
    add(4, '2021-11-18');
    // 2024 has none
    expect(picks('2026-11-18')).toEqual([
      [1, 1],
      [3, 2],
      [4, 3],
    ]);
  });

  it('leaves out a year with nothing within a week, and episodes that are not live', () => {
    add(1, '2024-11-26');
    add(2, '2025-11-18', { status: 'failed' });
    // seven days off is still in; eight (2024-11-26) is not
    add(3, '2023-11-11');
    expect(picks('2026-11-18')).toEqual([[3, 3]]);
  });

  it('goes by the Taipei date of the release', () => {
    // 2025-11-17 20:00 UTC is 11-18 04:00 in Taipei: the day itself, not one before
    db.prepare(`INSERT INTO episodes (episode_no, guid, title, published_at, audio_url, status, summary_json) VALUES (1, 'a', '⭐', '2025-11-17T20:00:00.000Z', 'x', 'done', '{}')`).run();
    add(2, '2025-11-17');
    expect(picks('2026-11-18')).toEqual([[1, 1]]);
  });

  it('reaches across New Year and never shows one episode twice', () => {
    add(1, '2024-12-30');
    add(2, '2026-01-01');
    // 2026-01-02: last year's day is 2025-01-02, three days after EP1; EP2 is this year
    expect(picks('2026-01-02')).toEqual([[1, 1]]);
    // one episode near two years' days goes to the nearer
    expect(picks('2025-12-31')).toEqual([[1, 1]]);
  });

  it('takes 2/29 as 2/28 in a year without it', () => {
    add(1, '2027-02-28');
    add(2, '2026-03-03');
    expect(picks('2028-02-29')).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });

  it('carries the line, the first key points and stocks, once each', () => {
    add(1, '2025-11-18');
    const [x] = onThisDay(db, '2026-11-18');
    expect(x!.line).toBe('EP1 的一句話');
    expect(x!.keys).toHaveLength(ON_THIS_DAY_KEYS);
    expect(x!.keys[0]).toEqual({ t: 60, text: '重點1' });
    expect(x!.stocks).toEqual(['台積電', '輝達', '蘋果', 'AMD'].slice(0, ON_THIS_DAY_STOCKS));
  });

  it('shows an episode whose summary is missing or broken without it', () => {
    db.prepare(`INSERT INTO episodes (episode_no, guid, title, published_at, audio_url, status, summary_json) VALUES (1, 'a', '⭐', '2025-11-18T07:00:00.000Z', 'x', 'done', 'not json')`).run();
    expect(onThisDay(db, '2026-11-18')).toEqual([expect.objectContaining({ no: 1, line: '', keys: [], stocks: [] })]);
  });

  it('leaves out an episode whose date does not parse, not the section', () => {
    add(1, '2025-11-18');
    db.prepare(`INSERT INTO episodes (episode_no, guid, title, published_at, audio_url, status, summary_json) VALUES (2, 'b', '⭐', 'someday', 'x', 'done', '{}')`).run();
    expect(picks('2026-11-18')).toEqual([[1, 1]]);
  });

  it('picks again once the day or the live episodes change', () => {
    add(1, '2025-11-18');
    expect(picks('2026-11-18')).toEqual([[1, 1]]);
    add(2, '2024-11-18');
    expect(picks('2026-11-18')).toEqual([
      [1, 1],
      [2, 2],
    ]);
    expect(picks('2026-06-01')).toEqual([]);
  });

  it('shows an episode whose keys or stocks are not shaped as the summary writes them, without them', () => {
    add(1, '2025-11-18', { summary: { line: '一句話', keys: 'abc', stocks: ['TSMC', { name: '台積電' }] } });
    add(2, '2024-11-18', { summary: { line: '另一句', keys: 5, stocks: 'TSMC' } });
    expect(onThisDay(db, '2026-11-18')).toEqual([
      expect.objectContaining({ no: 1, line: '一句話', keys: [], stocks: ['台積電'] }),
      expect.objectContaining({ no: 2, line: '另一句', keys: [], stocks: [] }),
    ]);
  });

  it('names the year a pick stands for, which near New Year is not always its own', () => {
    // 2027-01-02: 2025's day is 2025-01-02; the nearest is 2024-12-31
    add(1, '2024-12-31');
    add(2, '2026-01-02');
    expect(onThisDay(db, '2027-01-02').map((x) => [x.no, x.year, x.yearsAgo])).toEqual([
      [2, 2026, 1],
      [1, 2025, 2],
    ]);
  });

  it('is empty with no episodes', () => {
    expect(onThisDay(db, '2026-11-18')).toEqual([]);
  });
});
