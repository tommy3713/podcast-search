import { XMLParser } from 'fast-xml-parser';
import { RSS_URL, USER_AGENT } from './config.ts';

export type RssEpisode = {
  guid: string;
  episodeNo: number;
  title: string; // the part after "EP709 | ", usually a single emoji
  publishedAt: string; // ISO 8601 UTC
  audioUrl: string;
  duration: number | null;
};

export async function fetchFeed(url = RSS_URL): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`RSS ${res.status} ${res.statusText}`);
  return res.text();
}

// Newest first. Items without an EP number (trailers, specials) are skipped.
export function parseFeed(xml: string): RssEpisode[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false });
  const doc = parser.parse(xml);
  const raw = doc?.rss?.channel?.item ?? [];
  const items: unknown[] = Array.isArray(raw) ? raw : [raw];

  const episodes: RssEpisode[] = [];
  for (const it of items as Record<string, any>[]) {
    const fullTitle = text(it.title);
    const m = /EP\s*(\d+)/i.exec(fullTitle);
    const audioUrl = it.enclosure?.['@_url'];
    const guid = text(it.guid);
    const published = new Date(text(it.pubDate));
    if (!m || !audioUrl || !guid || Number.isNaN(published.getTime())) continue;
    episodes.push({
      guid,
      episodeNo: Number(m[1]),
      title: parseTitle(fullTitle),
      publishedAt: published.toISOString(),
      audioUrl,
      duration: parseDuration(text(it['itunes:duration'])),
    });
  }
  return episodes.sort((a, b) => b.episodeNo - a.episodeNo);
}

export function parseTitle(fullTitle: string): string {
  return fullTitle.replace(/^\s*EP\s*\d+\s*[|｜_:：-]?\s*/i, '').trim();
}

function parseDuration(s: string): number | null {
  if (!s) return null;
  const parts = s.split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function text(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') return String((v as Record<string, unknown>)['#text'] ?? '').trim();
  return String(v).trim();
}
