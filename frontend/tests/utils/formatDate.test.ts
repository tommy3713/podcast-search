import { describe, it, expect } from 'vitest';
import { formatDate } from '@/utils/index';

describe('formatDate', () => {
  it('formats 20231215 as December 15, 2023', () => {
    expect(formatDate('20231215')).toBe('December 15, 2023');
  });

  it('formats 20240101 as January 1, 2024', () => {
    expect(formatDate('20240101')).toBe('January 1, 2024');
  });

  it('formats 20230305 as March 5, 2023', () => {
    expect(formatDate('20230305')).toBe('March 5, 2023');
  });
});
