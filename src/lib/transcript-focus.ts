import { atWordEdges, matchStarts, placeParagraphs } from './format.ts';
import type { Segment } from './segments.ts';

// A link from an answer's source (/ep/<n>?t=&hl=) names the words it is about, since the
// source's time is where its ~600-character passage starts, often a minute or two before
// them. The episode page opens the transcript searching for those words, on the match the
// link means, and the player at the segment it is in.
export const MAX_HIGHLIGHT_CHARS = 40;

// `t`: the start of the segment the words begin in. `text`: what the search box gets (the
// words, or the piece of them that was found). `hit`: which of the transcript search's marks
// for `text` it is, counted from 0 over the whole episode.
export type TranscriptFocus = { t: number; text: string; hit: number };

// The words of ?hl=, or null when there are none or too many to be a quote
export function parseHighlight(raw: string | string[] | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/\s+/g, ' ').trim();
  return s && [...s].length <= MAX_HIGHLIGHT_CHARS ? s : null;
}

// What goes between the host's words in a quote or a transcript: punctuation the model may
// have changed, the comma a paragraph or passage puts between two segments, an ellipsis for
// words left out, and quote marks
const BREAKS = /[\s，。！？、：；,.!?…⋯「」『』“”"]+/;
// A shorter piece is too likely to be somewhere else (我覺得, 這個)
const MIN_PIECE_CHARS = 3;

// The pieces of a quote between its breaks, longest first, for when the whole isn't found
export function quotePieces(words: string): string[] {
  return words
    .split(BREAKS)
    .filter((p) => [...p].length >= MIN_PIECE_CHARS && p !== words)
    .sort((a, b) => b.length - a.length);
}

// A source's passage starts at `t` and runs about two and a half minutes, so the words are
// looked for from there; a mention's time is the summary's, which can be a little late.
const AFTER_SECONDS = 300;
const BEFORE_SECONDS = 60;

// The occurrence of `words` a link at `t` means: the first one at or after t, else the
// nearest one before it. Words that span two paragraphs (the search marks within one) are
// looked for by their longest piece that is. Null when none is close enough, so the page
// opens at t as before.
export function findFocus(segments: Segment[], t: number, words: string): TranscriptFocus | null {
  for (const w of [words, ...quotePieces(words)]) {
    const f = findOne(segments, t, w);
    if (f) return f;
  }
  return null;
}

function findOne(segments: Segment[], t: number, words: string): TranscriptFocus | null {
  let hit = 0;
  let before: TranscriptFocus | null = null;
  for (const p of placeParagraphs(segments)) {
    for (const at of matchStarts(p.text, words)) {
      const n = hit++;
      // Marked by the search, but inside a longer word (AI in again): not what the link means
      if (!atWordEdges(p.text, at, words.length)) continue;
      // The segment the match begins in
      let i = 0;
      while (i + 1 < p.segs.length && p.segs[i + 1]!.at <= at) i++;
      const start = p.segs[i]!.start;
      const found = { t: start, text: words, hit: n };
      if (start >= t - 1) return start <= t + AFTER_SECONDS ? found : before;
      if (start >= t - BEFORE_SECONDS) before = found;
    }
  }
  return before;
}
