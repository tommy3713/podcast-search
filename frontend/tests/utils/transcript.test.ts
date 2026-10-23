import { describe, it, expect } from 'vitest';
import { formatTimestamp, groupSegments } from '@/utils/transcript';

describe('formatTimestamp', () => {
  it('formats seconds under an hour as m:ss', () => {
    expect(formatTimestamp(0)).toBe('0:00');
    expect(formatTimestamp(75.6)).toBe('1:15');
  });

  it('formats an hour or more as h:mm:ss', () => {
    expect(formatTimestamp(3725)).toBe('1:02:05');
  });
});

describe('groupSegments', () => {
  it('returns no paragraphs for no segments', () => {
    expect(groupSegments([])).toEqual([]);
  });

  it('merges segments until the paragraph spans minSeconds', () => {
    const segments = [
      { start: 0, end: 4, text: '歡迎收聽股癌，' },
      { start: 4, end: 9, text: '我是謝孟恭。' },
      { start: 30, end: 35, text: '今天聊台積電。' },
      { start: 35, end: 40, text: '還有輝達。' },
      { start: 61, end: 65, text: '最後。' },
    ];

    expect(groupSegments(segments)).toEqual([
      { start: 0, text: '歡迎收聽股癌，我是謝孟恭。' },
      { start: 30, text: '今天聊台積電。還有輝達。' },
      { start: 61, text: '最後。' },
    ]);
  });
});
