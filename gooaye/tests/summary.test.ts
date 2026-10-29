import { describe, expect, it } from 'vitest';
import { formatTimestamp, type LlmSummary, parseTimestamp, sanitizeSummary } from '@/lib/summary.ts';

describe('timestamps', () => {
  it.each([
    ['30:49', 1849],
    ['0:05', 5],
    ['75:10', 4510],
    ['1:02:03', 3723],
  ])('%s → %d', (s, n) => expect(parseTimestamp(s)).toBe(n));

  it('rejects malformed values', () => {
    expect(parseTimestamp('abc')).toBeNull();
    expect(parseTimestamp('3:75')).toBeNull();
    expect(parseTimestamp('1849')).toBeNull();
  });

  it('formats seconds', () => expect(formatTimestamp(4510)).toBe('75:10'));
});

describe('sanitizeSummary', () => {
  const raw: LlmSummary = {
    keys: [{ t: '1:00', text: '重點' }, { t: '99:00', text: '超出長度' }],
    chapters: [
      { t: '10:00', title: '盤勢', ad: false, bullets: [{ t: '10:30', text: '多行\n文字' }], quote: null },
      { t: '0:00', title: '業配', ad: true, bullets: [], quote: { t: 'bad', text: 'x' } },
    ],
    stocks: [{ name: '台積電', code: '2330', t: '5:00', note: '說法' }, { name: 'Nvidia', code: 'nvda', t: '6:00', note: '' }],
    mentions: [{ category: '運動', name: '網球', t: '20:00', quote: '每天打網球' }],
  };
  const out = sanitizeSummary(raw, 50 * 60);

  it('drops items outside the episode and sorts chapters', () => {
    expect(out.keys).toEqual([{ t: 60, text: '重點' }]);
    expect(out.chapters.map((c) => c.title)).toEqual(['業配', '盤勢']);
    expect(out.chapters[0]!.quote).toBeNull();
  });

  it('flattens whitespace and normalizes tickers', () => {
    expect(out.chapters[1]!.bullets[0]!.text).toBe('多行 文字');
    expect(out.stocks[1]!.code).toBe('NVDA');
  });

  it('caps field length', () => {
    const long = sanitizeSummary({ ...raw, keys: [{ t: '1:00', text: '字'.repeat(500) }] }, 3000);
    expect([...long.keys[0]!.text]).toHaveLength(80);
  });
});
