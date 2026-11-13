// Sponsor pages (/sponsors, /sponsor/<slug>): every episode a sponsor paid for, from the
// summaries' ad chapters (chapters with `ad: true`). Nothing is stored: like the stock pages,
// they are built from summary_json when the index is.
//
// A chapter doesn't name its sponsor in one place. The title often does ("NordVPN業配"), but
// many titles name the product ("防滑業配", "坐墊腳凳業配") or nothing ("開場業配"); the
// first bullet often says 本集由 X 贊助; and speech-to-text spells one brand several ways
// (Saily as Sally or SETI). So a chapter is matched against SPONSOR_ALIASES first (its title,
// then its bullets in order), then the 本集由 X 贊助 phrase, then its title; a chapter with
// none of them is counted on /sponsors as 沒寫出品牌.
// Nothing heavy is imported here: no database, no zod.
import { searchKey, urlSlug as slugOf } from './stocks.ts';

// `title` is the chapter's; `episodeTitle` the episode's (an emoji, mostly)
export type AdChapter = {
  episodeNo: number;
  episodeTitle: string;
  publishedAt: string;
  audioUrl: string;
  title: string;
  t: number;
  bullets: { t: number; text: string }[];
};

// A brand and what its chapters say. Tried on the title first, then on each bullet in turn;
// within one text the brand named first wins, so a pitch for one brand that mentions another
// in passing (Saily is made by NordVPN's company) stays with its own. Latin names need word
// ends. Add a line when a backfill batch brings a new spelling.
export const SPONSOR_ALIASES: { name: string; slug: string; patterns: RegExp[] }[] = [
  { name: 'NordVPN', slug: 'nordvpn', patterns: [/nord ?vpn/i] },
  { name: 'Saily', slug: 'saily', patterns: [/\bsaily\b/i, /\bsally\b/i, /\bseti\b/i] },
  { name: '善存', slug: 'centrum', patterns: [/善存/, /\bcentrum\b/i] },
  { name: '火星生技', slug: 'mars-biotech', patterns: [/火星生技/, /5倍對策|五倍對策/] },
  // Heard as Duck 的情緒 once
  { name: 'Dr.情趣', slug: 'dr-qingqu', patterns: [/dr\.? ?情趣/i, /duck ?的情緒/i] },
  { name: 'Ray Chen', slug: 'ray-chen', patterns: [/ray ?chen/i, /正[脊級]坐墊/] },
  { name: 'ZZSleeper 忘憂枕', slug: 'zzsleeper', patterns: [/zzsleeper/i, /忘憂枕/] },
  { name: '喬治庸', slug: 'george-yung', patterns: [/喬治庸/] },
  { name: '修麗可', slug: 'skinceuticals', patterns: [/修[麗力]可/] },
  { name: '米紅生醫', slug: 'mihong', patterns: [/[米咪][紅鴻哄]生醫/] },
  { name: '飛利浦', slug: 'philips', patterns: [/飛利浦|菲利普/, /philips/i] },
  { name: '優勢資本徵才', slug: 'youshi-hiring', patterns: [/優勢(資本)?徵才/] },
  { name: 'iHerb', slug: 'iherb', patterns: [/\biherb\b/i] },
  { name: 'OSEN 體脂計', slug: 'osen', patterns: [/\bosen\b/i] },
  { name: '如意堂', slug: 'ruyitang', patterns: [/如意堂/] },
  { name: '優活', slug: 'youhuo', patterns: [/優活/] },
  { name: '棉豆腐', slug: 'cotton-tofu', patterns: [/棉豆腐/] },
  { name: 'MakeEasy', slug: 'makeeasy', patterns: [/make ?easy/i] },
];

// The phrase that most chapters open with: 本集由 X 贊助 / 本期由 X 贊助
const SPONSORED_BY = /本[集期]由\s*(.+?)\s*(?:贊助|冠名)/;
const MAX_NAME = 16;
// What a title says besides the sponsor: 開場業配, 中段業配：防滑, 業配時間, 廣告
const AD_WORDS = /(開場|本集|片頭|片尾|中段|本期)?\s*(業配|廣告|贊助)\s*(時間|段落)?\s*[：:、]?\s*/g;

// Below this a sponsor's page is noindex and out of the sitemap (it is still on /sponsors)
export const SPONSOR_INDEX_MIN_EPISODES = 2;

export type SponsorMatch = { name: string; slug: string; known: boolean };

// The brand a text names first, if any
function aliasIn(text: string): (typeof SPONSOR_ALIASES)[number] | null {
  let best: (typeof SPONSOR_ALIASES)[number] | null = null;
  let at = Infinity;
  for (const s of SPONSOR_ALIASES) {
    for (const p of s.patterns) {
      const i = text.search(p);
      if (i !== -1 && i < at) [best, at] = [s, i];
    }
  }
  return best;
}

// Who paid for a chapter, or null when nothing says
export function sponsorOf(ch: Pick<AdChapter, 'title' | 'bullets'>): SponsorMatch | null {
  for (const text of [ch.title, ...ch.bullets.map((b) => b.text)]) {
    const s = aliasIn(text);
    if (s) return { name: s.name, slug: s.slug, known: true };
  }
  // A long 本集由 X is usually the brand with its product and company; the title is shorter
  const by = ch.bullets.map((b) => SPONSORED_BY.exec(b.text)?.[1]?.trim()).find((x) => x && x.length <= MAX_NAME);
  const name = (by ?? ch.title.replace(AD_WORDS, ' ')).trim();
  const slug = slugOf(name);
  if (!name || !slug || name.length > MAX_NAME) return null;
  // An English name that is an alias's slug ("Centrum") is that brand
  const alias = SPONSOR_ALIASES.find((s) => s.slug === slug);
  return alias ? { name: alias.name, slug, known: true } : { name, slug, known: false };
}

export type SponsorEpisode = {
  no: number;
  title: string;
  publishedAt: string;
  audioUrl: string;
  // The ad chapter's start and its bullets: what was pitched. notes, so the stock pages'
  // month chart and play points work on it as they are.
  notes: { t: number; text: string }[];
  chapterTitle: string;
};

export type Sponsor = {
  slug: string;
  name: string;
  // false: the name came from a chapter, not SPONSOR_ALIASES, and may be a product
  known: boolean;
  // Newest first, by date
  episodes: SponsorEpisode[];
};

export type SponsorIndex = {
  bySlug: Map<string, Sponsor>;
  // Ad chapters nothing names a sponsor for
  unnamed: SponsorEpisode[];
};

export function buildSponsorIndex(chapters: AdChapter[]): SponsorIndex {
  const bySlug = new Map<string, Sponsor>();
  const unnamed: SponsorEpisode[] = [];
  for (const ch of chapters) {
    const ep: SponsorEpisode = {
      no: ch.episodeNo,
      title: ch.episodeTitle,
      publishedAt: ch.publishedAt,
      audioUrl: ch.audioUrl,
      chapterTitle: ch.title,
      // A copy: a second chapter of the same sponsor in the episode is added to it
      notes: ch.bullets.length ? [...ch.bullets] : [{ t: ch.t, text: ch.title }],
    };
    const m = sponsorOf(ch);
    if (!m) {
      unnamed.push(ep);
      continue;
    }
    let s = bySlug.get(m.slug);
    if (!s) bySlug.set(m.slug, (s = { slug: m.slug, name: m.name, known: m.known, episodes: [] }));
    // Two ad chapters for one sponsor in an episode: one entry, both chapters' bullets
    const same = s.episodes.find((e) => e.no === ep.no);
    if (same) {
      same.notes.push(...ep.notes);
      if (!same.chapterTitle.includes(ep.chapterTitle)) same.chapterTitle += `・${ep.chapterTitle}`;
    }
    else s.episodes.push(ep);
  }
  const byDate = (a: SponsorEpisode, b: SponsorEpisode) => (a.publishedAt === b.publishedAt ? b.no - a.no : a.publishedAt < b.publishedAt ? 1 : -1);
  for (const s of bySlug.values()) s.episodes.sort(byDate);
  unnamed.sort(byDate);
  return { bySlug, unnamed };
}

// /sponsors: by how many episodes, then the newest. A ranking is fine here: these are
// brands that paid for airtime, not something to invest in.
export function listedSponsors(index: SponsorIndex): Sponsor[] {
  const newest = (s: Sponsor) => s.episodes[0]!.publishedAt;
  return [...index.bySlug.values()].sort(
    (a, b) =>
      b.episodes.length - a.episodes.length ||
      (newest(a) === newest(b) ? (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0) : newest(a) < newest(b) ? 1 : -1),
  );
}

export function sponsorHref(s: Pick<Sponsor, 'slug'>): string {
  return `/sponsor/${encodeURIComponent(s.slug)}`;
}

// Days between the first and the newest episode, over the gaps: "about every N days"
export function averageGapDays(s: Sponsor): number | null {
  if (s.episodes.length < 2) return null;
  const ms = Date.parse(s.episodes[0]!.publishedAt) - Date.parse(s.episodes.at(-1)!.publishedAt);
  const days = Math.round(ms / 86_400_000 / (s.episodes.length - 1));
  // Two ads days apart say nothing about how often
  return days >= 1 ? days : null;
}

// Where each episode of the site falls between the oldest and the newest, 0 to 1: for the
// strip of dots on /sponsors
export function spanPosition(iso: string, from: string, to: string): number {
  const [a, b, x] = [Date.parse(from), Date.parse(to), Date.parse(iso)];
  return b > a ? Math.min(1, Math.max(0, (x - a) / (b - a))) : 1;
}

export function findSponsor(index: SponsorIndex, segment: string): Sponsor | null {
  return index.bySlug.get(segment) ?? index.bySlug.get(slugOf(segment)) ?? [...index.bySlug.values()].find((s) => searchKey(s.name) === searchKey(segment)) ?? null;
}
