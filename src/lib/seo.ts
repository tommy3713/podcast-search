import type { EpisodeDetail } from './episodes.ts';
import { type Stock, shownCode } from './stocks.ts';

// Canonical origin for links search engines and share cards see, whatever host served the page
export const SITE_URL = 'https://gooaye-notes.com';
export const SITE_NAME = '股癌搜尋';

// Episode titles are a single emoji, so search results lead with the episode number and the
// one-line summary instead. "股癌 EP709" comes first because that is how people search.
function cleanLine(line: string): string {
  return line.replace(/^聊\s*/, '').replace(/[。.]\s*$/, '').trim();
}

export function episodeTitle(no: number, line: string): string {
  const s = cleanLine(line);
  return s ? `股癌 EP${no}｜${s}` : `股癌 EP${no}`;
}

const DESCRIPTION_TAIL = '每集重點、章節與附時間戳的逐字稿，非官方粉絲整理。';
const DESCRIPTION_MAX = 150;

export function episodeDescription(summary: { line: string; keys: { text: string }[] }): string {
  const parts = [summary.line, ...summary.keys.slice(0, 2).map((k) => k.text)].map(cleanLine).filter(Boolean);
  // By code point, so an emoji or a rare CJK character is never cut in half
  const body = Array.from(parts.join('；'));
  if (!body.length) return DESCRIPTION_TAIL;
  // Search results show about 120 CJK characters; keep the episode's own words first
  const room = DESCRIPTION_MAX - Array.from(DESCRIPTION_TAIL).length - 1;
  return `${body.length > room ? `${body.slice(0, room - 1).join('')}…` : `${body.join('')}。`}${DESCRIPTION_TAIL}`;
}

// "台積電（2330）", or just the name when there is no code or the name is the code
export function stockName(stock: Pick<Stock, 'name' | 'code'>): string {
  const code = shownCode(stock);
  return code ? `${stock.name}（${code}）` : stock.name;
}

// "股癌 台積電" is how people search, so it leads, like "股癌 EP709" on an episode
export function stockTitle(stock: Stock): string {
  return `股癌 ${stockName(stock)}｜在 ${stock.episodes.length} 集提到`;
}

// Says where, never what he thinks of it. Under 150 characters with the longest name and code
// a summary can hold.
export function stockDescription(stock: Stock): string {
  const eps = stock.episodes.slice(0, 3).map((e) => `EP${e.no}`).join('、');
  const n = stock.episodes.length;
  return `《股癌》主持人在 ${eps} ${n > 3 ? `等 ${n} 集` : ''}提到${stockName(stock)}：每一集說了什麼、在第幾分鐘。非官方粉絲整理，不是投資建議。`;
}

function isoDuration(seconds: number): string {
  const s = Math.round(seconds);
  return `PT${Math.floor(s / 3600)}H${Math.floor((s % 3600) / 60)}M${s % 60}S`;
}

// schema.org PodcastEpisode. Rendered inside <script>, so `<` is escaped: summaries come from
// a model reading untrusted transcripts.
export function episodeJsonLd(ep: EpisodeDetail): string {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'PodcastEpisode',
    name: episodeTitle(ep.no, ep.summary.line),
    episodeNumber: ep.no,
    url: `${SITE_URL}/ep/${ep.no}`,
    datePublished: ep.publishedAt,
    description: episodeDescription(ep.summary),
    associatedMedia: { '@type': 'MediaObject', contentUrl: ep.audioUrl, ...(ep.duration ? { duration: isoDuration(ep.duration) } : {}) },
    partOfSeries: { '@type': 'PodcastSeries', name: '股癌 Gooaye' },
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
  };
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

// app/opengraph-image.png (X falls back to it too). Pages that set their own openGraph no
// longer inherit the file-based image, so they list it explicitly; this alt text is the
// only copy.
export const SHARE_IMAGE = {
  url: '/opengraph-image.png',
  width: 1200,
  height: 630,
  alt: '股癌搜尋：《股癌 Gooaye》每集重點、逐字稿和跨集數問答（非官方粉絲網站）',
};

// openGraph + twitter for a page with its own title; keeps the share image and site name
export function shareMetadata(title: string, url: string, description?: string) {
  return {
    openGraph: { type: 'website' as const, url, title, siteName: SITE_NAME, locale: 'zh_TW', images: [SHARE_IMAGE], ...(description ? { description } : {}) },
    twitter: { card: 'summary_large_image' as const, title, images: [SHARE_IMAGE], ...(description ? { description } : {}) },
  };
}
