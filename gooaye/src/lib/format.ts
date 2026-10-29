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

// Whisper segments are only a few seconds long; merge them into paragraphs of at
// least `minSeconds` so the transcript reads as prose with a timestamp per paragraph.
export function groupParagraphs(segments: Segment[], minSeconds = 30): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let current: Paragraph | null = null;
  for (const seg of segments) {
    if (!current || seg.start - current.start >= minSeconds) {
      current = { start: seg.start, text: '' };
      paragraphs.push(current);
    } else if (!/[，。！？、：；,.!?]$/.test(current.text)) {
      current.text += '，';
    }
    current.text += seg.text;
  }
  return paragraphs;
}
