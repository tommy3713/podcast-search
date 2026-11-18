import { describe, expect, it } from 'vitest';
import type { Source } from '@/lib/ask/agent.ts';
import { citedOrder, OTHER_SOURCES_SHOWN, parseAnswer } from '@/lib/ask/render.ts';
import data from '@/lib/ask/showcase.json';
import { dropOffer, keptSources, SHOWCASE_QUESTIONS, ShowcaseSchema, showcase } from '@/lib/ask/showcase.ts';

describe('the committed showcase', () => {
  const items = showcase();

  it('answers every question, in order, in the file itself (the signed-in page loads it as is)', () => {
    expect(items.map((i) => i.q)).toEqual(SHOWCASE_QUESTIONS);
    expect(ShowcaseSchema.parse(data).map((i) => i.q)).toEqual(SHOWCASE_QUESTIONS);
  });

  it.each(items.map((i) => [i.q, i] as const))('cites only sources it carries: %s', (_, item) => {
    const cited = citedOrder(parseAnswer(item.text, 'all'));
    expect(cited.length).toBeGreaterThan(0);
    const have = new Set(item.sources.map((s) => s.n));
    for (const n of cited) expect(have.has(n)).toBe(true);
    // The prompt allows no URLs, and the page shows these in the site's name
    expect(item.text).not.toMatch(/https?:|www\./);
    expect(dropOffer(item.text)).toBe(item.text);
    expect(item.oldest).toBeLessThanOrEqual(item.newest);
    expect(item.count).toBeLessThanOrEqual(item.newest - item.oldest + 1);
    expect(item.othersFound).toBeGreaterThanOrEqual(item.sources.length - cited.length);
  });
});

describe('keptSources', () => {
  const src = (n: number, ep: number, t = 0): Source => ({ n, ep, t, text: `段落${n}`, label: null });

  it('keeps the cited sources and the first others the page shows, counting all the others', () => {
    const sources = Array.from({ length: 30 }, (_, i) => src(i + 1, 100 + i));
    const kept = keptSources('- 這集有講 [3][7]\n- 那集也有 [20]', sources);
    // Cited 3, 7 and 20; the first OTHER_SOURCES_SHOWN (8) of the rest are 1, 2, 4, 5, 6, 8, 9, 10
    expect(OTHER_SOURCES_SHOWN).toBe(8);
    expect(kept.sources.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20]);
    expect(kept.othersFound).toBe(27);
  });

  it('drops numbers the answer made up', () => {
    expect(keptSources('是這集 [2][99]', [src(1, 1), src(2, 2)]).sources.map((s) => s.n)).toEqual([1, 2]);
  });
});

describe('dropOffer', () => {
  it('drops a closing offer to do more, and nothing else', () => {
    const body = '- EP706：他說「越賣越高」 [47]';
    expect(dropOffer(`${body}\n如果你要，我也可以再幫你把這幾集各自的原話抓出來。`)).toBe(body);
    expect(dropOffer(`${body}\n\n需要的話我可以整理成表格`)).toBe(body);
    expect(dropOffer(body)).toBe(body);
    // Only at the end, and only an offer
    expect(dropOffer(`如果你要找的是 EP1，我也可以說是這集 [1]\n${body}`)).toBe(`如果你要找的是 EP1，我也可以說是這集 [1]\n${body}`);
    expect(dropOffer(`${body}\n如果你要找原話，可以點出處。`)).toBe(`${body}\n如果你要找原話，可以點出處。`);
  });
});
