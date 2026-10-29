import type { Segment } from '@/lib/segments.ts';

export type Chunk = { idx: number; startSec: number; text: string };

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
