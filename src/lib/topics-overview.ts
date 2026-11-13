// What /topics shows besides the lists: the strip of what the newest episodes brought up, and
// each card's monthly series. Pure functions over the indexes.
import { type SponsorIndex, listedSponsors, sponsorHref } from './sponsors.ts';
import { stockMonths } from './stocks.ts';
import { listedTopics, TOPIC_CATEGORIES, type TopicIndex, topicHref } from './topics.ts';

export type RecentItem = { href: string; label: string; kind: string; episodeNo: number };

// Everything the newest live episodes (`newest`, newest first) brought up. An episode that
// brought up nothing here just adds nothing.
export function recentItems(topics: TopicIndex, sponsors: SponsorIndex, newest: number[]): RecentItem[] {
  const all: RecentItem[] = [];
  for (const c of TOPIC_CATEGORIES) {
    for (const i of listedTopics(topics, c.slug)) {
      for (const e of i.episodes) all.push({ href: topicHref(i), label: i.name, kind: c.label, episodeNo: e.no });
    }
  }
  for (const s of listedSponsors(sponsors)) {
    for (const e of s.episodes) all.push({ href: sponsorHref(s), label: s.name, kind: '業配', episodeNo: e.no });
  }
  const seen = new Set<string>();
  return newest.flatMap((no) => all.filter((x) => x.episodeNo === no && !seen.has(x.href) && seen.add(x.href)));
}

// How many mentions each month, over the site's whole span (the months of `liveMonths`); null
// for a month the site has no episode for (not backfilled yet), which is not the same as zero
export function monthlySeries(dates: string[], liveMonths: Map<string, number>): (number | null)[] {
  return stockMonths({ episodes: dates.map((publishedAt) => ({ publishedAt })) }, liveMonths).map((m) => (m.episodes > 0 ? m.mentioned : null));
}
