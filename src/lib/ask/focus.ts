import { MAX_HIGHLIGHT_CHARS } from '../transcript-focus.ts';
import type { Source } from './agent.ts';
import type { Block } from './render.ts';

// A source's time is where its passage starts, often a minute or two before what the answer
// says about it (EP609's source opened on a wallet ad, two paragraphs above 「秋口繼續幹你娘」).
// So each cited source gets the words the answer is about: the earliest of its passage's
// words that a line citing it quotes, else of the search terms the server found in it. The
// card's preview starts there, and its link names them (?hl=) for the episode page.
export type SourceFocus = { at: number; text: string };

const QUOTES = /「([^「」]+)」|『([^『』]+)』|“([^“”]+)”/g;
// What the model's quotes leave out or add between the host's words
const BREAKS = /[\s，。！？、：；,.!?…⋯]+/;
const MIN_CHARS = 2;

// The quotes in an answer's line
export function quotesIn(text: string): string[] {
  return [...text.matchAll(QUOTES)].map((m) => (m[1] ?? m[2] ?? m[3])!.trim()).filter((q) => [...q].length >= MIN_CHARS);
}

// Where `words` occur in a passage, case ignored. A quote the model shortened (「…」 inside,
// a comma it changed) is tried by its pieces, longest first.
export function findWords(text: string, words: string): SourceFocus | null {
  const lower = text.toLowerCase();
  const tries = [words, ...words.split(BREAKS).sort((a, b) => b.length - a.length)];
  for (const w of tries) {
    if ([...w].length < MIN_CHARS) continue;
    const at = lower.indexOf(w.toLowerCase());
    if (at === -1) continue;
    // Cut by code point to fit ?hl=, and taken from the passage, so its case and width are the
    // transcript's
    return { at, text: [...text.slice(at, at + w.length)].slice(0, MAX_HIGHLIGHT_CHARS).join('').trim() };
  }
  return null;
}

// For each cited source, the words to open it at; sources with none are left out
export function sourceFocus(blocks: Block[], sources: Record<number, Source>): Map<number, SourceFocus> {
  const quoted = new Map<number, string[]>();
  for (const b of blocks) {
    const text = b.parts.map((p) => (p.kind === 'cite' ? '' : p.text)).join('');
    const qs = quotesIn(text);
    for (const p of b.parts) if (p.kind === 'cite') quoted.set(p.n, [...(quoted.get(p.n) ?? []), ...qs]);
  }
  const out = new Map<number, SourceFocus>();
  for (const [n, qs] of quoted) {
    const s = sources[n];
    if (!s) continue;
    // A quote the line names explicitly beats a search term; among them, the earliest in the passage
    const pick = (words: string[]) =>
      words
        .map((w) => findWords(s.text, w))
        .filter((f): f is SourceFocus => f !== null && f.text.length > 0)
        .sort((a, b) => a.at - b.at)[0];
    const f = pick(qs) ?? pick(s.terms ?? []);
    if (f) out.set(n, f);
  }
  return out;
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
