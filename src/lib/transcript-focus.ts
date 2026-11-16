import { matchStarts, placeParagraphs } from './format.ts';
import type { Segment } from './segments.ts';

// A link from an answer's source (/ep/<n>?t=&hl=) names the words it is about, since the
// source's time is where its ~600-character passage starts, often a minute or two before
// them. The episode page opens the transcript searching for those words, on the match the
// link means, and the player at the segment it is in.
export const MAX_HIGHLIGHT_CHARS = 40;

// `t`: the start of the segment the words begin in. `hit`: which of the transcript search's
// marks for `text` it is, counted from 0 over the whole episode.
export type TranscriptFocus = { t: number; text: string; hit: number };

// The words of ?hl=, or null when there are none or too many to be a quote
export function parseHighlight(raw: string | string[] | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/\s+/g, ' ').trim();
  return s && [...s].length <= MAX_HIGHLIGHT_CHARS ? s : null;
}

// A source's passage starts at `t` and runs about two and a half minutes, so the words are
// looked for from there; a mention's time is the summary's, which can be a little late.
const AFTER_SECONDS = 300;
const BEFORE_SECONDS = 60;

// The occurrence of `words` a link at `t` means: the first one at or after t, else the
// nearest one before it; null when none is close enough, so the page opens at t as before
export function findFocus(segments: Segment[], t: number, words: string): TranscriptFocus | null {
  let hit = 0;
  let before: TranscriptFocus | null = null;
  for (const p of placeParagraphs(segments)) {
    for (const at of matchStarts(p.text, words)) {
      // The segment the match begins in
      let i = 0;
      while (i + 1 < p.segs.length && p.segs[i + 1]!.at <= at) i++;
      const start = p.segs[i]!.start;
      const found = { t: start, text: words, hit: hit++ };
      if (start >= t - 1) return start <= t + AFTER_SECONDS ? found : before;
      if (start >= t - BEFORE_SECONDS) before = found;
    }
  }
  return before;
}
