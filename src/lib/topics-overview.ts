// What /topics shows besides the lists: the strip of what the newest episodes brought up, and
// each card's monthly series. Pure functions over the indexes.
import { type SponsorIndex, listedSponsors, sponsorHref } from './sponsors.ts';
import { monthKey } from './format.ts';
import { monthIndex, stockMonths } from './stocks.ts';
import { listedTopics, TOPIC_CATEGORIES, TOPIC_INDEX_MIN_EPISODES, type TopicIndex, topicHref } from './topics.ts';

export type RecentItem = { href: string; label: string; kind: string; episodeNo: number };

// Which strip: every category and the sponsors (/topics), the sponsors only, or one category
export type RecentScope = 'all' | 'sponsors' | { category: string };

// Everything the newest live episodes (`newest`, newest first) brought up. An episode that
// brought up nothing here just adds nothing. A thing that came up once links straight to
// the moment, like the 提過一次 chips: its own page would say no more than the episode.
export function recentItems(topics: TopicIndex, sponsors: SponsorIndex, newest: number[], scope: RecentScope = 'all'): RecentItem[] {
  const wanted = new Set(newest);
  const all: RecentItem[] = [];
  if (scope !== 'sponsors') {
    for (const c of TOPIC_CATEGORIES) {
      if (typeof scope === 'object' && scope.category !== c.slug) continue;
      for (const i of listedTopics(topics, c.slug)) {
        for (const e of i.episodes) {
          if (!wanted.has(e.no)) continue;
          const href = i.episodes.length >= TOPIC_INDEX_MIN_EPISODES ? topicHref(i) : `/ep/${e.no}?t=${e.notes[0]!.t}`;
          all.push({ href, label: i.name, kind: c.label, episodeNo: e.no });
        }
      }
    }
  }
  if (scope === 'all' || scope === 'sponsors') {
    for (const s of listedSponsors(sponsors)) for (const e of s.episodes) if (wanted.has(e.no)) all.push({ href: sponsorHref(s), label: s.name, kind: '業配', episodeNo: e.no });
  }
  const seen = new Set<string>();
  return newest.flatMap((no) => all.filter((x) => x.episodeNo === no && !seen.has(x.label + x.kind) && seen.add(x.label + x.kind)));
}

// Big cards for the first two, when there are enough cards after them to fill rows
const BIG_CARDS = 2;
const BIG_MIN_CARDS = 6;
export function bigCards(cards: number): number {
  return cards >= BIG_MIN_CARDS ? BIG_CARDS : 0;
}

// How many mentions each month, over the site's whole span (the months of `liveMonths`); null
// for a month the site has no episode for (not backfilled yet), which is not the same as zero
export function monthlySeries(dates: string[], liveMonths: Map<string, number>): (number | null)[] {
  return stockMonths({ episodes: dates.map((publishedAt) => ({ publishedAt })) }, liveMonths).map((m) => (m.episodes > 0 ? m.mentioned : null));
}

// The months of `liveMonths` from the one `from` falls in on: an item's chart starts where it
// first came up instead of drawing the site's earlier years empty
export function spanFrom(liveMonths: Map<string, number>, from: string): Map<string, number> {
  const first = monthKey(from);
  return new Map([...liveMonths].filter(([k]) => k >= first));
}

// Months from the first to the last date, both counted: "持續 8 個月"
export function monthsBetween(from: string, to: string): number {
  return monthIndex(monthKey(to)) - monthIndex(monthKey(from)) + 1;
}
