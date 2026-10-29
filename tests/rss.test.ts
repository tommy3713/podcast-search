import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFeed, parseTitle } from '../worker/rss.ts';

const xml = fs.readFileSync(new URL('./fixtures/feed.xml', import.meta.url), 'utf8');

describe('parseFeed', () => {
  it('parses episodes newest first', () => {
    const eps = parseFeed(xml);
    expect(eps.map((e) => e.episodeNo)).toEqual([709, 708, 651]);
    expect(eps[0]).toMatchObject({
      guid: '499a0c9f-1a36-4d5b-b9ca-ee2b2510e0bd',
      title: '⭐',
      publishedAt: '2026-10-28T08:13:55.000Z',
      duration: 3135,
    });
    expect(eps[0]!.audioUrl).toMatch(/^https:\/\/rss\.soundon\.fm\/.+\.mp3/);
  });

  it('keeps text titles', () => {
    expect(parseFeed(xml).find((e) => e.episodeNo === 651)!.title).toBe('One for all');
  });

  it('skips items without an EP number', () => {
    const trailer = xml.replace('EP708 | 🦷', '預告');
    expect(parseFeed(trailer).map((e) => e.episodeNo)).toEqual([709, 651]);
  });
});

describe('parseTitle', () => {
  it.each([
    ['EP709 | ⭐', '⭐'],
    ['EP638 | 🐈‍⬛', '🐈‍⬛'],
    ['EP500_🍜', '🍜'],
    ['EP651 ｜ One for all', 'One for all'],
  ])('%s → %s', (input, out) => expect(parseTitle(input)).toBe(out));
});
