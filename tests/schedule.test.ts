import { describe, expect, it } from 'vitest';
import { isLastPollSlot, isNightlySlot, isPollSlot, nextHalfHour, taipeiTime } from '../worker/schedule.ts';

// Taipei is UTC+8: 2026-10-28 is a Wednesday
const at = (iso: string) => taipeiTime(new Date(iso));

describe('schedule', () => {
  it('polls Wed/Sat 10:00–23:30 Taipei on the half hour', () => {
    expect(isPollSlot(at('2026-10-28T02:00:00Z'))).toBe(true); // Wed 10:00
    expect(isPollSlot(at('2026-10-28T15:30:00Z'))).toBe(true); // Wed 23:30
    expect(isPollSlot(at('2026-10-28T01:30:00Z'))).toBe(false); // Wed 09:30
    expect(isPollSlot(at('2026-10-28T02:15:00Z'))).toBe(false);
    expect(isPollSlot(at('2026-10-29T02:00:00Z'))).toBe(false); // Thu
    expect(isPollSlot(at('2026-10-31T06:00:00Z'))).toBe(true); // Sat 14:00
  });

  it('crosses midnight in Taipei, not UTC', () => {
    // 2026-10-27 16:00Z is Wed 00:00 in Taipei: right day, too early
    expect(at('2026-10-27T16:00:00Z')).toMatchObject({ date: '2026-10-28', weekday: 3, hour: 0 });
  });

  it('marks the last poll and the nightly slot', () => {
    expect(isLastPollSlot(at('2026-10-28T15:30:00Z'))).toBe(true);
    expect(isLastPollSlot(at('2026-10-28T15:00:00Z'))).toBe(false);
    expect(isNightlySlot(at('2026-10-28T19:00:00Z'))).toBe(true); // 03:00 Taipei
  });

  it('finds the next half-hour boundary', () => {
    expect(nextHalfHour(new Date('2026-10-28T02:10:00Z')).toISOString()).toBe('2026-10-28T02:30:00.000Z');
    expect(nextHalfHour(new Date('2026-10-28T02:30:00Z')).toISOString()).toBe('2026-10-28T03:00:00.000Z');
  });
});
