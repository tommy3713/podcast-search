import { z } from 'zod';
import data from './showcase.json';
import { citedOrder, OTHER_SOURCES_SHOWN, otherSources, parseAnswer } from './render.ts';
import type { Source } from './agent.ts';

// Answers shown on /ask before anyone asks: signed out, where the page was a login wall
// (about 480 loads of /ask against a few dozen questions in 30 days), and signed in, before
// the first question. Each was asked once through answer() by scripts/ask-showcase.ts and
// committed, so the owner reads every word the site shows in its own name before it ships.
// Nothing about the host's views: each asks where something was said.
// showcase.json keeps this order (the script writes it so), which the lazy load relies on.
export const SHOWCASE_QUESTIONS = [
  '主委在哪幾集說到外資在賣台股或提款？依時間列出',
  '哪一集主委提到去參加小島秀夫的活動？',
  '哪集有提到「為什麼要一直跟別人比自己的小孩，我們來比家長啊，所有人坐一桌，把自己的銀行帳戶攤開來比誰比較有錢」',
];

const SourceSchema = z
  .object({
    n: z.number().int().positive(),
    ep: z.number().int().positive(),
    t: z.number().nonnegative(),
    text: z.string(),
    label: z.string().nullable(),
    terms: z.array(z.string()).optional(),
  })
  .strict();

const ItemSchema = z
  .object({
    q: z.string().min(1),
    // Taipei day it was asked, and the live episodes then (a count: backfill can leave gaps)
    askedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    count: z.number().int().positive(),
    oldest: z.number().int().positive(),
    newest: z.number().int().positive(),
    model: z.string(),
    // The model's text as streamed, [n] citations included (the page labels the lines)
    text: z.string().min(1),
    sources: z.array(SourceSchema),
    // How many passages the searches found that the answer didn't use, of which `sources`
    // keeps the first OTHER_SOURCES_SHOWN: 不是你要找的？ says the real number
    othersFound: z.number().int().nonnegative(),
  })
  .strict();

export type ShowcaseItem = z.infer<typeof ItemSchema>;

export const ShowcaseSchema = z.array(ItemSchema);

// The sources an answer needs on the page: the ones it cites and the first few others
// (不是你要找的？ shows OTHER_SOURCES_SHOWN), so the file doesn't carry fifty passages each
export function keptSources(text: string, sources: Source[]): { sources: Source[]; othersFound: number } {
  const byN = Object.fromEntries(sources.map((s) => [s.n, s]));
  const cited = citedOrder(parseAnswer(text, new Set(sources.map((s) => s.n))));
  const others = otherSources(byN, cited);
  const keep = new Set([...cited, ...others.slice(0, OTHER_SOURCES_SHOWN).map((s) => s.n)]);
  return { sources: sources.filter((s) => keep.has(s.n)).sort((a, b) => a.n - b.n), othersFound: others.length };
}

// A closing offer to do more (如果你要，我也可以再…): the page can't follow up on an answer, and
// these sit on the page in the site's name. The script drops one, and nothing else.
const OFFER = /\n+[^\n]*(如果你(要|需要|想)|需要的話|要的話)[^\n]*我也?可以[^\n]*$/;

export function dropOffer(text: string): string {
  return text.replace(OFFER, '').trim();
}

// Parsed once: the file is part of the build
let parsed: ShowcaseItem[] | undefined;

// In SHOWCASE_QUESTIONS' order; an answer to a question no longer listed is left out
export function showcase(): ShowcaseItem[] {
  parsed ??= (() => {
    const items = ShowcaseSchema.parse(data);
    return SHOWCASE_QUESTIONS.flatMap((q) => items.find((i) => i.q === q) ?? []);
  })();
  return parsed;
}
