import { describe, expect, it } from 'vitest';
import type { EpisodeDetail } from '@/lib/episodes';
import { episodeDescription, episodeJsonLd, episodeTitle } from '@/lib/seo';

describe('episodeTitle', () => {
  it('leads with 股癌 EP<n> and the summary, without 聊 or the closing 。', () => {
    expect(episodeTitle(709, '聊跑步練心、Apple折疊機、台美AI行情與Anthropic IPO。')).toBe(
      '股癌 EP709｜跑步練心、Apple折疊機、台美AI行情與Anthropic IPO',
    );
    expect(episodeTitle(705, '震盪盤策略、AI投資雜音與育兒運動近況')).toBe('股癌 EP705｜震盪盤策略、AI投資雜音與育兒運動近況');
  });

  it('falls back to the episode number when there is no summary', () => {
    expect(episodeTitle(1, '')).toBe('股癌 EP1');
  });
});

describe('episodeDescription', () => {
  const summary = { line: '聊市場流動性。', keys: [{ text: '重點一。' }, { text: '重點二' }, { text: '重點三' }] };

  it('joins the summary and the first two key points, then says what the page has', () => {
    expect(episodeDescription(summary)).toBe('市場流動性；重點一；重點二。每集重點、章節與附時間戳的逐字稿，非官方粉絲整理。');
  });

  it('stays within 150 characters, cutting the episode text rather than the tail', () => {
    const long = episodeDescription({ line: '長'.repeat(300), keys: [] });
    expect(Array.from(long).length).toBeLessThanOrEqual(150);
    expect(long).toContain('…每集重點');
    expect(long.endsWith('非官方粉絲整理。')).toBe(true);
  });

  it('never cuts an emoji in half', () => {
    const long = episodeDescription({ line: '🦷'.repeat(300), keys: [] });
    expect(long).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(Array.from(long).length).toBeLessThanOrEqual(150);
  });

  it('is just the tail when there is no summary', () => {
    expect(episodeDescription({ line: '聊。', keys: [] })).toBe('每集重點、章節與附時間戳的逐字稿，非官方粉絲整理。');
  });
});

describe('episodeJsonLd', () => {
  const ep = {
    no: 709,
    title: '⭐',
    publishedAt: '2026-10-28T06:00:00.000Z',
    duration: 3134,
    line: '',
    stocks: [],
    audioUrl: 'https://filesb.soundon.fm/a.mp3',
    segments: [],
    summary: { line: '聊 </script><script>alert(1)</script>', keys: [], chapters: [], stocks: [], mentions: [] },
  } as unknown as EpisodeDetail;

  it('describes a PodcastEpisode with its duration', () => {
    const d = JSON.parse(episodeJsonLd(ep));
    expect(d).toMatchObject({
      '@type': 'PodcastEpisode',
      episodeNumber: 709,
      url: 'https://gooaye-notes.com/ep/709',
      associatedMedia: { '@type': 'MediaObject', duration: 'PT0H52M14S' },
    });
  });

  it('cannot close its <script> tag, since summaries come from untrusted transcripts', () => {
    const json = episodeJsonLd(ep);
    expect(json).not.toContain('<');
    expect(JSON.parse(json).name).toContain('</script>');
  });
});
