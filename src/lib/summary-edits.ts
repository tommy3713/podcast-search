import type { Summary } from './summary.ts';
import { replaceOpen } from './transcript-edits.ts';

// The summary's texts a listener reads, and so can report and an admin can correct: the
// line, key points, chapter titles, bullets and quotes, stocks' names and notes, and
// mentions' names and quotes. Not codes or categories, which are identifiers.
export function summaryTexts(s: Summary): string[] {
  return [
    s.line,
    ...s.keys.map((k) => k.text),
    ...s.chapters.flatMap((c) => [c.title, ...c.bullets.map((b) => b.text), ...(c.quote ? [c.quote.text] : [])]),
    ...s.stocks.flatMap((x) => [x.name, x.note]),
    ...s.mentions.flatMap((m) => [m.name, m.quote]),
  ];
}

// Occurrences of `wrong` in those texts. With `right`, only the ones a correction to it would
// change (not those already inside `right`: 台積 in 台積電).
export function countInSummary(s: Summary, wrong: string, right = ''): number {
  if (!wrong) return 0;
  return summaryTexts(s).reduce((n, t) => n + (right ? replaceOpen(t, wrong, right).count : t.split(wrong).length - 1), 0);
}

// Every occurrence of `wrong` in those texts replaced by `right`, except where `right` is
// already written (replaceOpen), and how many were
export function replaceInSummary(s: Summary, wrong: string, right: string): { summary: Summary; count: number } {
  let count = 0;
  const r = (t: string) => {
    const x = replaceOpen(t, wrong, right);
    count += x.count;
    return x.text;
  };
  const summary: Summary = {
    ...s,
    line: r(s.line),
    keys: s.keys.map((k) => ({ ...k, text: r(k.text) })),
    chapters: s.chapters.map((c) => ({
      ...c,
      title: r(c.title),
      bullets: c.bullets.map((b) => ({ ...b, text: r(b.text) })),
      quote: c.quote && { ...c.quote, text: r(c.quote.text) },
    })),
    stocks: s.stocks.map((x) => ({ ...x, name: r(x.name), note: r(x.note) })),
    mentions: s.mentions.map((m) => ({ ...m, name: r(m.name), quote: r(m.quote) })),
  };
  return { summary, count };
}
