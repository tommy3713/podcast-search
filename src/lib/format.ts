import type { Segment } from './segments.ts';

const TAIPEI_OFFSET_MS = 8 * 3600_000;
const WEEKDAYS = '日一二三四五六';

function taipei(iso: string): Date {
  return new Date(new Date(iso).getTime() + TAIPEI_OFFSET_MS);
}

// "2026/08/08（六）" in Taipei time
export function formatDate(iso: string): string {
  const d = taipei(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}（${WEEKDAYS[d.getUTCDay()]}）`;
}

// "2026 年 8 月"
export function monthLabel(iso: string): string {
  const d = taipei(iso);
  return `${d.getUTCFullYear()} 年 ${d.getUTCMonth() + 1} 月`;
}

// "2026-08" in Taipei time: sorts as text, and is what the stock pages group by
export function monthKey(iso: string): string {
  const d = taipei(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function minutes(duration: number | null): number | null {
  return duration ? Math.round(duration / 60) : null;
}

// RSS titles are usually one emoji ("EP686 | 🕸️") but some are words ("EP651 | One for all")
export function isEmojiTitle(s: string): boolean {
  return s.replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}‍️⃣\s]/gu, '') === '';
}

// ZWJ sequences like 🐈‍⬛ count as one
export function graphemeCount(s: string): number {
  return [...new Intl.Segmenter().segment(s.replace(/\s/g, ''))].length;
}

export type Paragraph = { start: number; text: string };

// Whisper segments rarely end in punctuation; a comma goes between two that don't
export function appendSegment(text: string, next: string): string {
  return text && !/[，。！？、：；,.!?]$/.test(text) ? `${text}，${next}` : text + next;
}

// The start of the paragraph each segment goes in: a segment starts a new paragraph once
// `minSeconds` have passed since the current one started
export function paragraphStarts(segments: Segment[], minSeconds = 30): number[] {
  let start: number | null = null;
  return segments.map((seg) => {
    if (start === null || seg.start - start >= minSeconds) start = seg.start;
    return start;
  });
}

// Whisper segments are only a few seconds long; merge them into paragraphs of at
// least `minSeconds` so the transcript reads as prose with a timestamp per paragraph.
export function groupParagraphs(segments: Segment[], minSeconds = 30): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const starts = paragraphStarts(segments, minSeconds);
  segments.forEach((seg, i) => {
    const last = paragraphs.at(-1);
    if (last && last.start === starts[i]) last.text = appendSegment(last.text, seg.text);
    else paragraphs.push({ start: starts[i]!, text: seg.text });
  });
  return paragraphs;
}
