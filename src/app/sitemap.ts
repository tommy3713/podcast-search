import type { MetadataRoute } from 'next';
import { sitemapEpisodes } from '@/lib/episodes';
import { SITE_URL } from '@/lib/seo';
import { SPONSOR_INDEX_MIN_EPISODES, listedSponsors, sponsorHref } from '@/lib/sponsors';
import { stockData } from '@/lib/stock-pages';
import { listedStocks, stockHref } from '@/lib/stocks';
import { listedTopics, TOPIC_CATEGORIES, TOPIC_INDEX_MIN_EPISODES, topicCategoryHref, topicHref } from '@/lib/topics';

// Built per request from the database, so a new episode is listed as soon as it goes live
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const episodes = await sitemapEpisodes();
  const latest = episodes[0]?.publishedAt;
  const { index, sponsors, topics } = await stockData();
  // Only the pages /stocks lists; the rest are noindex. A page changes when a newer episode joins it.
  const stocks = listedStocks(index).flatMap((g) => g.stocks);
  // Sponsors with one episode are on /sponsors but noindex, like stocks
  const sponsorPages = listedSponsors(sponsors).filter((s) => s.episodes.length >= SPONSOR_INDEX_MIN_EPISODES);
  // Items with one episode are noindex: the category page links straight to the moment
  const topicItems = TOPIC_CATEGORIES.flatMap((c) => listedTopics(topics, c.slug).filter((i) => i.episodes.length >= TOPIC_INDEX_MIN_EPISODES));
  return [
    // The list changes when a new episode comes out
    { url: `${SITE_URL}/`, lastModified: latest, changeFrequency: 'weekly', priority: 1 },
    ...episodes.map((e) => ({ url: `${SITE_URL}/ep/${e.no}`, lastModified: e.publishedAt, changeFrequency: 'monthly' as const })),
    { url: `${SITE_URL}/stocks`, lastModified: latest, changeFrequency: 'weekly' },
    ...stocks.map((s) => ({ url: `${SITE_URL}${stockHref(s)}`, lastModified: s.episodes[0]!.publishedAt, changeFrequency: 'weekly' as const })),
    { url: `${SITE_URL}/sponsors`, lastModified: latest, changeFrequency: 'weekly' },
    ...sponsorPages.map((s) => ({ url: `${SITE_URL}${sponsorHref(s)}`, lastModified: s.episodes[0]!.publishedAt, changeFrequency: 'monthly' as const })),
    { url: `${SITE_URL}/topics`, lastModified: latest, changeFrequency: 'weekly' },
    ...TOPIC_CATEGORIES.flatMap((c) => {
      const items = listedTopics(topics, c.slug);
      if (!items.length) return [];
      const newest = items.map((i) => i.episodes[0]!.publishedAt).sort().at(-1);
      return [{ url: `${SITE_URL}${topicCategoryHref(c)}`, lastModified: newest, changeFrequency: 'weekly' as const }];
    }),
    ...topicItems.map((i) => ({ url: `${SITE_URL}${topicHref(i)}`, lastModified: i.episodes[0]!.publishedAt, changeFrequency: 'monthly' as const })),
    { url: `${SITE_URL}/about`, changeFrequency: 'yearly' },
  ];
}
