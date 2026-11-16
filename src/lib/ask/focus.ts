import { findExact } from '../format.ts';
import { MAX_HIGHLIGHT_CHARS, quotePieces } from '../transcript-focus.ts';
import type { Source } from './agent.ts';
import type { Block } from './render.ts';

// A source's time is where its passage starts, often a minute or two before what the answer
// says about it (EP609's source opened on a wallet ad, two paragraphs above 「秋口繼續幹你娘」).
// So each cited source gets the words the answer is about: what the line citing it quotes
// from its passage, else the search terms the server found in it. The card's preview starts
// there, and its link names them (?hl=) for the episode page.
export type SourceFocus = { at: number; text: string };

// Each kind on its own, so a quote inside a quote (「他說『可以試看看』」) is tried too
const QUOTES = [/「([^「」]+)」/g, /『([^『』]+)』/g, /“([^“”]+)”/g];
const MIN_CHARS = 2;

// The quotes in some of an answer's text
export function quotesIn(text: string): string[] {
  return QUOTES.flatMap((re) => [...text.matchAll(re)].map((m) => m[1]!.trim())).filter((q) => [...q].length >= MIN_CHARS);
}

// Where `words` occur in a passage, case ignored and not inside a longer Latin word. A quote
// the model shortened (「…」 inside, a comma it changed) is tried by its pieces, longest first;
// `whole` says whether the words themselves were found.
export function findWords(text: string, words: string): (SourceFocus & { whole: boolean }) | null {
  for (const w of [words, ...quotePieces(words)]) {
    if ([...w].length < MIN_CHARS) continue;
    const at = findExact(text, w);
    if (at === -1) continue;
    // Cut by code point to fit ?hl=, and taken from the passage, so its case and width are the
    // transcript's
    const found = [...text.slice(at, at + w.length)].slice(0, MAX_HIGHLIGHT_CHARS).join('').trim();
    if (found) return { at, text: found, whole: w === words };
  }
  return null;
}

// The quotes a line makes for each source it cites: `own` are the ones since the citations
// before (「A」[1]，「B」[2] gives [1] A and [2] B), `line` every quote of a line citing it
type Quotes = { own: Map<number, string[]>; line: Map<number, string[]> };

function citedQuotes(blocks: Block[]): Quotes {
  const own = new Map<number, string[]>();
  const line = new Map<number, string[]>();
  const add = (m: Map<number, string[]>, n: number, qs: string[]) => m.set(n, [...(m.get(n) ?? []), ...qs]);
  for (const b of blocks) {
    const lineQuotes = quotesIn(b.parts.map((p) => (p.kind === 'cite' ? '' : p.text)).join(''));
    let since = '';
    let group: string[] | null = null; // the quotes of the run of citations being read
    for (const p of b.parts) {
      if (p.kind === 'cite') {
        group ??= quotesIn(since);
        since = '';
        add(own, p.n, group);
        add(line, p.n, lineQuotes);
      } else {
        if (p.text.trim()) group = null;
        since += p.text;
      }
    }
  }
  return { own, line };
}

// For each cited source, the words to open it at; sources with none are left out. Words
// quoted next to its own citation come first, then the rest of the lines citing it, then the
// search terms. Within each, a quote found whole beats a piece of one: the earliest whole one
// in the passage, else the longest piece, since a short piece (我覺得) can be anywhere.
export function sourceFocus(blocks: Block[], sources: Record<number, Source>): Map<number, SourceFocus> {
  const { own, line } = citedQuotes(blocks);
  const out = new Map<number, SourceFocus>();
  for (const n of line.keys()) {
    const s = sources[n];
    if (!s) continue;
    const found = (words: string[]) => words.map((w) => findWords(s.text, w)).filter((f) => f !== null);
    const tiers = [found(own.get(n) ?? []), found(line.get(n) ?? [])];
    const whole = tiers.map((fs) => fs.filter((f) => f.whole).sort((a, b) => a.at - b.at)[0]).find(Boolean);
    const piece = tiers.map((fs) => fs.sort((a, b) => b.text.length - a.text.length || a.at - b.at)[0]).find(Boolean);
    const f = whole ?? piece ?? termFocus(s);
    if (f) out.set(n, { at: f.at, text: f.text });
  }
  return out;
}

// The first of the search's words the passage holds: where to point a passage the answer
// doesn't quote from, or doesn't cite at all
export function termFocus(s: Source): SourceFocus | undefined {
  const f = (s.terms ?? [])
    .map((w) => findWords(s.text, w))
    .filter((x) => x !== null)
    .sort((a, b) => a.at - b.at)[0];
  return f ? { at: f.at, text: f.text } : undefined;
}

export function sourceHref(s: Source, f: SourceFocus | undefined): string {
  return `/ep/${s.ep}?t=${Math.floor(s.t)}${f ? `&hl=${encodeURIComponent(f.text)}` : ''}`;
}

// The passage from a little before the words, for a two-line preview that shows them
const LEAD_CHARS = 12;
export function previewParts(text: string, f: SourceFocus | undefined): { before: string; words: string; after: string } {
  if (!f) return { before: text, words: '', after: '' };
  const from = Math.max(0, f.at - LEAD_CHARS);
  return { before: (from > 0 ? '…' : '') + text.slice(from, f.at), words: text.slice(f.at, f.at + f.text.length), after: text.slice(f.at + f.text.length) };
}
