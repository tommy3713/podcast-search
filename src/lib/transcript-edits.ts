import type { Segment } from './segments.ts';

// An admin's correction of one transcript segment: its whole text before and after. The
// segment is the one starting at segStart (timestamps can't be edited) whose text is
// oldText; when that's gone (a retranscription, or an edit made against a text that changed
// since), the change is looked for nearby by what it changed (editDiff).
export type TranscriptEdit = { id: number; segStart: number; oldText: string; newText: string };

// exact: the segment was there as the edit saw it. nearby: the changed words were found in
// a segment within NEARBY_SECONDS. already: they weren't, but the corrected words were
// (the transcript already says it right). missing: neither.
export type EditOutcome = 'exact' | 'nearby' | 'already' | 'missing';

// For exact and nearby, where the edit now applies (`index` into the segments, since two
// segments can share a start), so the stored row can follow it
export type EditResult = { id: number; outcome: EditOutcome; index?: number; segStart?: number; oldText?: string; newText?: string };

export const NEARBY_SECONDS = 30;
export const MAX_SEGMENT_CHARS = 1000;
// The changed part is widened to at least this many characters before it's looked for
// elsewhere, so a one-character change doesn't land on the first 的 nearby. When the wider
// words aren't there (the context crossed into another segment), 2 are tried.
const MIN_DIFF_CHARS = 3;
const FALLBACK_DIFF_CHARS = 2;

// What an edit changed: the shortest differing span of each text, widened with the
// characters around it to `min` where the old text has them, and where that starts in the
// old text (`at`, in UTF-16 units). Widened by code points, so a surrogate pair is never split.
export function editDiff(oldText: string, newText: string, min = MIN_DIFF_CHARS): { wrong: string; right: string; at: number } {
  const a = [...oldText];
  const b = [...newText];
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  let left = p;
  let rightTrim = s;
  // Widen both sides together, left first
  while (a.length - left - rightTrim < min && (left > 0 || rightTrim > 0)) {
    if (left > 0) left--;
    if (a.length - left - rightTrim < min && rightTrim > 0) rightTrim--;
  }
  return {
    wrong: a.slice(left, a.length - rightTrim).join(''),
    right: b.slice(left, b.length - rightTrim).join(''),
    at: a.slice(0, left).join('').length,
  };
}

function occurrences(text: string, term: string): number[] {
  const out: number[] = [];
  for (let i = text.indexOf(term); i >= 0; i = text.indexOf(term, i + 1)) out.push(i);
  return out;
}

// Where `wrong` occurs in `text`, leaving out occurrences inside `right` already written
// there (`fixed`): an insertion at a segment's edge widens to one side only, so `wrong` can be
// part of `right`, and 叫做輝 → 叫做輝達 must not turn 叫做輝達 into 叫做輝達達
function openOccurrences(text: string, wrong: string, right: string): { open: number[]; fixed: boolean } {
  const inRight = occurrences(right, wrong);
  const all = occurrences(text, wrong);
  const open = all.filter((q) => !inRight.some((k) => q >= k && text.startsWith(right, q - k)));
  return { open, fixed: open.length < all.length };
}

// Replaces the occurrences of `wrong` in `text` (at most `limit`, from the start) that aren't
// already part of `right` written there, so a suggestion that contains the words (台積 → 台積電)
// never doubles text that's already right. How many it replaced.
export function replaceOpen(text: string, wrong: string, right: string, limit = Infinity): { text: string; count: number } {
  if (!wrong) return { text, count: 0 };
  let out = '';
  let last = 0;
  let count = 0;
  for (const q of openOccurrences(text, wrong, right).open) {
    if (count >= limit) break;
    if (q < last) continue; // overlapping occurrences (aa in aaa): the first one wins
    out += text.slice(last, q) + right;
    last = q + wrong.length;
    count++;
  }
  return { text: out + text.slice(last), count };
}

// Applies edits in order to a copy of the segments. An edit applies to the segment it was
// made on if that is unchanged; otherwise its change is applied in the nearest segment
// within NEARBY_SECONDS that has the old words, at the occurrence nearest where it was.
export function applyEdits(segments: Segment[], edits: TranscriptEdit[]): { segments: Segment[]; results: EditResult[] } {
  const segs = segments.map((s) => ({ ...s }));
  const results: EditResult[] = [];
  for (const e of edits) {
    const exact = segs.findIndex((s) => s.start === e.segStart && s.text === e.oldText);
    if (exact >= 0) {
      segs[exact]!.text = e.newText;
      results.push({ id: e.id, outcome: 'exact', index: exact, segStart: e.segStart, oldText: e.oldText, newText: e.newText });
      continue;
    }
    const near = segs
      .map((s, index) => ({ s, index }))
      .filter(({ s }) => Math.abs(s.start - e.segStart) <= NEARBY_SECONDS)
      .sort((x, y) => Math.abs(x.s.start - e.segStart) - Math.abs(y.s.start - e.segStart));
    const diffs = [editDiff(e.oldText, e.newText), editDiff(e.oldText, e.newText, FALLBACK_DIFF_CHARS)].filter(
      (d) => [...d.wrong].length >= FALLBACK_DIFF_CHARS,
    );
    let result: EditResult | undefined;
    let fixed = false;
    for (const d of diffs) {
      for (const { s, index } of near) {
        const found = openOccurrences(s.text, d.wrong, d.right);
        fixed ||= found.fixed;
        if (!found.open.length) continue;
        const q = found.open.reduce((best, x) => (Math.abs(x - d.at) < Math.abs(best - d.at) ? x : best));
        const oldText = s.text;
        s.text = oldText.slice(0, q) + d.right + oldText.slice(q + d.wrong.length);
        result = { id: e.id, outcome: 'nearby', index, segStart: s.start, oldText, newText: s.text };
        break;
      }
      if (result) break;
    }
    if (!result) {
      const already = fixed || diffs.some((d) => [...d.right].length >= FALLBACK_DIFF_CHARS && near.some(({ s }) => s.text.includes(d.right)));
      result = { id: e.id, outcome: already ? 'already' : 'missing' };
    }
    results.push(result);
  }
  return { segments: segs, results };
}

// Newlines and tabs can't be typed into a segment; the rest is kept as typed
export function cleanSegmentText(s: string): string {
  return s.replace(/[\r\n\t]+/g, ' ').trim();
}

// Every segment containing `wrong` (`index` into the segments: two can share a start), with
// its text after replacing each occurrence not already inside `right` (replaceOpen)
export function replaceMatches(
  segments: Segment[],
  wrong: string,
  right: string,
): { index: number; start: number; oldText: string; newText: string; count: number }[] {
  if (!wrong) return [];
  return segments.flatMap((s, index) => {
    const r = replaceOpen(s.text, wrong, right);
    return r.count ? [{ index, start: s.start, oldText: s.text, newText: r.text, count: r.count }] : [];
  });
}
