// Taiwan has no DST, so Asia/Taipei is always UTC+8.
const TAIPEI_OFFSET_MS = 8 * 3600_000;

export type TaipeiTime = { date: string; weekday: number; hour: number; minute: number };

export function taipeiTime(d: Date): TaipeiTime {
  const t = new Date(d.getTime() + TAIPEI_OFFSET_MS);
  return {
    date: t.toISOString().slice(0, 10),
    weekday: t.getUTCDay(),
    hour: t.getUTCHours(),
    minute: t.getUTCMinutes(),
  };
}

// Episodes come out on Wednesday and Saturday afternoons (Taipei), so RSS is only
// polled then: every 30 minutes from 10:00 to 23:30.
export function isPollSlot(t: TaipeiTime): boolean {
  return (t.weekday === 3 || t.weekday === 6) && t.hour >= 10 && t.minute % 30 === 0;
}

// Last poll of a release day: report if nothing went live
export function isLastPollSlot(t: TaipeiTime): boolean {
  return isPollSlot(t) && t.hour === 23 && t.minute === 30;
}

export function isNightlySlot(t: TaipeiTime): boolean {
  return t.hour === 3 && t.minute === 0;
}

// Next :00 or :30 boundary strictly after `now`
export function nextHalfHour(now: Date): Date {
  const step = 30 * 60_000;
  return new Date(Math.floor(now.getTime() / step) * step + step);
}
