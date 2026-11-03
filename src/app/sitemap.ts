import type { MetadataRoute } from 'next';
import { sitemapEpisodes } from '@/lib/episodes';
import { SITE_URL } from '@/lib/seo';

// Built per request from the database, so a new episode is listed as soon as it goes live
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const episodes = await sitemapEpisodes();
  return [
    // The list changes when a new episode comes out
    { url: `${SITE_URL}/`, lastModified: episodes[0]?.publishedAt, changeFrequency: 'weekly', priority: 1 },
    ...episodes.map((e) => ({ url: `${SITE_URL}/ep/${e.no}`, lastModified: e.publishedAt, changeFrequency: 'monthly' as const })),
    { url: `${SITE_URL}/about`, changeFrequency: 'yearly' },
  ];
}
