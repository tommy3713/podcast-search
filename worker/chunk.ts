import type { Segment } from '@/lib/segments.ts';
import type { Summary } from '@/lib/summary.ts';

export type Chunk = { idx: number; startSec: number; text: string };

// A summary text to embed and the part of the episode it describes: its chapter, from the
// chapter's start to the next one's (null: the end of the episode)
export type SummaryPoint = { startSec: number; endSec: number | null; text: string };

// One point per chapter (title and bullets together; one vector per bullet found the same
// episodes with four times the rows) and one per key point, which covers the chapter it
// falls in. Ad chapters, and key points inside one, are left out.
export function summaryPoints(summary: Summary): SummaryPoint[] {
  const chapters = [...summary.chapters].sort((a, b) => a.t - b.t);
  const range = (i: number) => ({ startSec: chapters[i]!.t, endSec: chapters[i + 1]?.t ?? null });
  const points: SummaryPoint[] = [];
  chapters.forEach((c, i) => {
    if (c.ad) return;
    const bullets = c.bullets.map((b) => b.text).join(' ');
    points.push({ ...range(i), text: bullets ? `${c.title}：${bullets}` : c.title });
  });
  for (const k of summary.keys) {
    const i = chapters.findLastIndex((c) => c.t <= k.t);
    if (i >= 0 && chapters[i]!.ad) continue;
    // Before the first chapter (or with none): from the start up to the first chapter
    points.push({ ...(i >= 0 ? range(i) : { startSec: 0, endSec: chapters[0]?.t ?? null }), text: k.text });
  }
  return points;
}

const TARGET_CHARS = 600;

// Chunks follow segment boundaries so each one has a start time to link to.
// Consecutive chunks share one segment so a fact split at a boundary is still findable.
export function chunkSegments(segs: Segment[], target = TARGET_CHARS): Chunk[] {
  const chunks: Chunk[] = [];
  let i = 0;
  while (i < segs.length) {
    let j = i;
    let len = 0;
    while (j < segs.length && (len < target || j === i)) len += [...segs[j++]!.text].length;
    chunks.push({
      idx: chunks.length,
      startSec: Math.floor(segs[i]!.start),
      text: joinSegments(segs.slice(i, j)),
    });
    if (j >= segs.length) break;
    i = j - 1 > i ? j - 1 : j;
  }
  return chunks;
}

// Whisper segments have no trailing punctuation; separate them with a comma unless
// one is already there.
export function joinSegments(segs: Segment[]): string {
  return segs.reduce((acc, s) => {
    if (!acc) return s.text;
    return /[，。！？、：；,.!?]$/.test(acc) ? acc + s.text : `${acc}，${s.text}`;
  }, '');
}
