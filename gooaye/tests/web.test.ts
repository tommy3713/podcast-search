import { describe, expect, it } from 'vitest';
import { formatDate, graphemeCount, groupParagraphs, isEmojiTitle, monthLabel } from '@/lib/format';
import { clampPage, pageCount, pageOfIndex, pageOffset, pagerItems } from '@/lib/paging';

describe('paging', () => {
  // 84 episodes: 1 hero + 83 rows → 5 pages, the last with 3 rows
  it('counts pages after the hero', () => {
    expect(pageCount(84)).toBe(5);
    expect(pageCount(1)).toBe(1);
    expect(pageCount(21)).toBe(1);
    expect(pageCount(22)).toBe(2);
  });

  it('clamps the page parameter', () => {
    expect(clampPage(undefined, 84)).toBe(1);
    expect(clampPage('3', 84)).toBe(3);
    expect(clampPage('99', 84)).toBe(5);
    expect(clampPage('-2', 84)).toBe(1);
    expect(clampPage('abc', 84)).toBe(1);
  });

  it('maps an episode back to its list page', () => {
    expect(pageOfIndex(0)).toBe(1); // hero
    expect(pageOfIndex(20)).toBe(1);
    expect(pageOfIndex(21)).toBe(2);
    expect(pageOffset(2)).toBe(21);
    // round trip: every index lands on the page whose offset range contains it
    for (let i = 1; i < 84; i++) {
      const p = pageOfIndex(i);
      expect(i >= pageOffset(p) && i < pageOffset(p) + 20).toBe(true);
    }
  });

  it('builds the pager with gaps', () => {
    expect(pagerItems(1, 5)).toEqual([1, 2, 'gap', 5]);
    expect(pagerItems(3, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pagerItems(5, 9)).toEqual([1, 'gap', 4, 5, 6, 'gap', 9]);
    expect(pagerItems(1, 1)).toEqual([1]);
  });
});

describe('format', () => {
  it('shows dates in Taipei time', () => {
    // 2026-10-27 16:30Z is Wednesday 00:30 in Taipei
    expect(formatDate('2026-10-27T16:30:00.000Z')).toBe('2026/10/28（三）');
    expect(monthLabel('2026-07-31T17:00:00.000Z')).toBe('2026 年 8 月');
  });

  it('tells emoji titles from word titles', () => {
    expect(isEmojiTitle('🕸️')).toBe(true);
    expect(isEmojiTitle('🐈‍⬛')).toBe(true);
    expect(isEmojiTitle('🇹🇼')).toBe(true);
    expect(isEmojiTitle('One for all')).toBe(false);
    expect(graphemeCount('🐈‍⬛')).toBe(1);
    expect(graphemeCount('🍜 🍣')).toBe(2);
  });

  it('merges segments into 30s paragraphs', () => {
    const seg = (start: number, text: string) => ({ start, end: start + 5, text });
    expect(groupParagraphs([seg(0, '一'), seg(10, '二。'), seg(20, '三'), seg(31, '四')])).toEqual([
      { start: 0, text: '一，二。三' },
      { start: 31, text: '四' },
    ]);
  });
});
