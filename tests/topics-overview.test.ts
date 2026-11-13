import { describe, expect, it } from 'vitest';
import { type AdChapter, buildSponsorIndex } from '@/lib/sponsors.ts';
import { monthlySeries, recentItems } from '@/lib/topics-overview.ts';
import { buildTopicIndex, type TopicRow } from '@/lib/topics.ts';

const at = (no: number) => `2026-${String(1 + (no % 12)).padStart(2, '0')}-10T04:00:00Z`;
const row = (no: number, category: string, name: string, publishedAt = at(no)): TopicRow => ({
  category,
  name,
  quote: name,
  startSec: 60,
  episodeNo: no,
  title: '⭐',
  publishedAt,
  audioUrl: 'https://x',
});
const ad = (no: number, title: string, publishedAt = at(no)): AdChapter => ({ episodeNo: no, episodeTitle: '⭐', publishedAt, audioUrl: 'https://x', title, t: 0, bullets: [] });

describe('recentItems', () => {
  it('takes the newest live episodes as given, even one that brought nothing up', () => {
    const topics = buildTopicIndex([row(712, '運動', '網球', '2026-11-07T04:00:00Z')]);
    expect(recentItems(topics, buildSponsorIndex([]), [714, 713]).map((r) => r.label)).toEqual([]);
    expect(recentItems(topics, buildSponsorIndex([]), [714, 712]).map((r) => r.label)).toEqual(['網球']);
  });

  it('lists what the newest two episodes brought up, newest first, once each', () => {
    const topics = buildTopicIndex([
      row(713, '運動', '網球', '2026-11-11T04:00:00Z'),
      row(713, '遊戲', '妮姬', '2026-11-11T04:00:00Z'),
      row(712, '運動', '網球', '2026-11-07T04:00:00Z'),
      row(712, '旅遊', '日本', '2026-11-07T04:00:00Z'),
      row(711, '美食', '麥當勞', '2026-11-04T04:00:00Z'),
    ]);
    const sponsors = buildSponsorIndex([ad(713, 'NordVPN業配', '2026-11-11T04:00:00Z')]);
    expect(recentItems(topics, sponsors, [713, 712]).map((r) => [r.episodeNo, r.kind, r.label])).toEqual([
      [713, '運動', '網球'],
      [713, '電玩', '勝利女神：妮姬'],
      [713, '業配', 'NordVPN'],
      [712, '旅遊', '日本'],
    ]);
  });
});

describe('monthlySeries', () => {
  it('counts mentions per month over the site’s whole span, a month without episodes as a gap', () => {
    const live = new Map([['2026-01', 4], ['2026-02', 4], ['2026-04', 4]]);
    // March has no episode on the site; February has some and none of them brought it up
    expect(monthlySeries(['2026-01-10T04:00:00Z', '2026-01-20T04:00:00Z', '2026-04-01T04:00:00Z'], live)).toEqual([2, 0, null, 1]);
  });
});
