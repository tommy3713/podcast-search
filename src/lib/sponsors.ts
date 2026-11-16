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
// `nameOnly`: tried only on the title and on the X of 本集由 X 贊助, never on a bullet, for
// names that are everyday words (簡單) or that other ads mention in passing (三星, Elden Ring)
export const SPONSOR_ALIASES: { name: string; slug: string; patterns: RegExp[]; nameOnly?: boolean }[] = [
  { name: 'NordVPN', slug: 'nordvpn', patterns: [/nord ?vpn/i] },
  { name: 'Saily', slug: 'saily', patterns: [/\bsaily\b/i, /\bsally\b/i, /\bseti\b/i] },
  { name: '善存', slug: 'centrum', patterns: [/善存/, /\bcentrum\b/i] },
  { name: '火星生技', slug: 'mars-biotech', patterns: [/火星生技/, /5倍對策|五倍對策/] },
  // Heard as Duck 的情緒, Duck的情趣 and Duckt情趣
  { name: 'Dr.情趣', slug: 'dr-qingqu', patterns: [/dr\.? ?情趣/i, /\bduck ?t? ?的?情[緒趣]/i] },
  { name: 'Ray Chen', slug: 'ray-chen', patterns: [/ray ?chen/i, /正[脊級]坐墊/] },
  { name: 'ZZSleeper 忘憂枕', slug: 'zzsleeper', patterns: [/zzsleeper/i, /忘憂枕/] },
  { name: '喬治庸', slug: 'george-yung', patterns: [/喬治[庸永用]/] },
  { name: '修麗可', slug: 'skinceuticals', patterns: [/修[麗力利]可/] },
  // Also written 米紅, 米宏, 咪哄 and Mihon; 生醫 heard as 生衣. Without 生醫 only in a chapter
  // title (米紅業配, 米鴻乳清業配), where the name is the brand
  { name: '米鴻生醫', slug: 'mihong', patterns: [/[米咪][紅鴻哄宏]生[醫衣]/, /\bmihon\b/i, /^[米咪][紅鴻哄宏](業配|乳清|馬卡)/] },
  { name: '飛利浦', slug: 'philips', patterns: [/飛利浦|菲利普/, /philips/i] },
  { name: '優勢資本徵才', slug: 'youshi-hiring', patterns: [/優勢(資本)?徵才/] },
  { name: 'iHerb', slug: 'iherb', patterns: [/\biherb\b/i] },
  { name: 'OSEN 體脂計', slug: 'osen', patterns: [/\bosen\b/i] },
  { name: '如意堂', slug: 'ruyitang', patterns: [/如意堂/] },
  { name: '優活', slug: 'youhuo', patterns: [/優活/] },
  { name: '棉豆腐', slug: 'cotton-tofu', patterns: [/[棉綿]豆腐/] },
  { name: 'MakeEasy', slug: 'makeeasy', patterns: [/make ?easy/i] },
  // Bayer's vitamin tablets: 拜維佳, also written 拜維加, with or without 台灣拜耳 / 拜爾
  { name: '拜維佳', slug: 'berocca', patterns: [/拜維[佳加]/, /\bberocca\b/i] },
  // Bayer's vitamin C tablets, written six ways
  { name: '力度伸', slug: 'redoxon', patterns: [/力度[伸生]|利杜森/, /\bredoxon\b/i] },
  { name: 'VoiceTube', slug: 'voicetube', patterns: [/\bvoice ?tube\b/i] },
  // 本集由 Pressplay Academy 贊助 is too long a name, so the title (英文課業配) won. Not
  // Pressplay alone: other sellers' courses are on that platform too
  { name: 'Pressplay Academy', slug: 'pressplay', patterns: [/\bpress ?play academy\b/i] },
  // Brands from EP1–199, each spelled several ways
  { name: '森歐黎漾', slug: 'senorian-saholia', patterns: [/森歐[黎里][漾昂亞]/, /\bsenori?y?an\b/i, /\bsahol(e|i)?a\b/i] },
  { name: 'A-Lux 亞立詩', slug: 'a-lux', patterns: [/\ba-?lux\b/i, /\balox\b/i, /亞[立歷]詩|亞歷斯/] },
  { name: 'OVO', slug: 'ovo', patterns: [/\bovo\b/i] },
  { name: 'Vtex', slug: 'vtex', patterns: [/\bvte[xc]\b/i] },
  // Other ads (Shopback) mention Kobo in passing
  { name: '樂天 Kobo', slug: 'kobo', patterns: [/^樂天 ?kobo/i], nameOnly: true },
  { name: '簡單', slug: 'simple-skincare', patterns: [/^簡單(保養)?$/, /品牌「?簡單」?$/], nameOnly: true },
  { name: 'BFAC', slug: 'bfac', patterns: [/\bbfac/i] },
  { name: '麥格瑞', slug: 'mackmyra', patterns: [/麥格瑞/, /\bmackmyra\b/i] },
  { name: '給我五分鐘', slug: 'give-me-five', patterns: [/給我五分鐘/] },
  // 營養師輕食, heard as 青石 and 親實
  { name: '營養師輕食', slug: 'dietitian-light', patterns: [/營養師(輕食|青石|親實)/, /青石益生菌/] },
  { name: '茄子輕旅', slug: 'eggplant-hostel', patterns: [/茄子(輕旅|情侶)/] },
  { name: '雅曼菲', slug: 'yamanfei', patterns: [/[雅亞]曼菲/] },
  { name: 'GroupM', slug: 'groupm', patterns: [/\bgroup ?m\b/i] },
  { name: 'SBD', slug: 'sbd', patterns: [/\bsbd\b/i] },
  { name: 'Backbone', slug: 'backbone', patterns: [/\bbackbone\b/i] },
  { name: 'Bioniq', slug: 'bioniq', patterns: [/\bbioni[cq]\b/i] },
  { name: '綠藤生機', slug: 'greenvines', patterns: [/綠藤生[機技]/] },
  { name: '寶拉珍選', slug: 'paulas-choice', patterns: [/[寶保]拉[珍甄]選/, /paula'?s choice/i, /^寶拉(業配)?$/] },
  { name: 'Zenyam 戰亞', slug: 'zenyam', patterns: [/戰亞/, /\bzenyam\b/i] },
  { name: '花旗', slug: 'citi', patterns: [/^花旗/], nameOnly: true },
  { name: '巴黎萊雅', slug: 'loreal-paris', patterns: [/^(巴黎)?萊雅$/], nameOnly: true },
  // 豐存股 and 大戶投 are its products; 永豐大戶 is the bank's account, a separate sponsor
  { name: '永豐金證券', slug: 'sinopac-securities', patterns: [/永豐金證券|豐存股/] },
  { name: '白蘭氏', slug: 'brands', patterns: [/白蘭氏/] },
  { name: '知識衛星', slug: 'knowledge-satellite', patterns: [/知識衛星/] },
  { name: 'TravelBlue', slug: 'travelblue', patterns: [/travel ?blue/i] },
  { name: '蝦皮書城', slug: 'shopee-books', patterns: [/蝦皮(書城|閱讀節)/] },
  { name: '水果豬', slug: 'fruit-pig', patterns: [/水果[豬出]高級進口水果店/, /^水果豬/] },
  { name: '蔻蘿蘭', slug: 'klorane', patterns: [/蔻蘿蘭/, /\bcolor?an\b/i, /\bklorane\b/i] },
  { name: '田中義和', slug: 'tanaka', patterns: [/田中義和/] },
  { name: '橘子工坊', slug: 'orange-house', patterns: [/橘子工坊/] },
  // 賞心樂事 gives away Electrolux mixers in its own ads
  { name: '伊萊克斯', slug: 'electrolux', patterns: [/^伊萊克斯/, /^electrolux/i] },
  { name: '亞新集團', slug: 'yahsin', patterns: [/亞新(集團|天會|森會)/] },
  { name: 'Moft', slug: 'moft', patterns: [/\bmoft\b/i] },
  { name: 'WOKI', slug: 'woki', patterns: [/\bwoki\b/i] },
  { name: 'Walkie', slug: 'walkie', patterns: [/\bwalkie\b/i] },
  { name: 'Vana', slug: 'vana', patterns: [/\bvana\b/i] },
  { name: '阿斗', slug: 'adou', patterns: [/^阿斗/], nameOnly: true },
  { name: 'MULA', slug: 'mula', patterns: [/\bmula\b/i] },
  { name: 'HP 印表機', slug: 'hp', patterns: [/^hp ?印表機/i], nameOnly: true },
  { name: '艾爾登法環', slug: 'elden-ring', patterns: [/^(艾爾登)?法環$|^elden ring$/i], nameOnly: true },
  { name: 'PlayStation', slug: 'playstation', patterns: [/^playstation/i], nameOnly: true },
  { name: 'Sony', slug: 'sony', patterns: [/^sony/i], nameOnly: true },
  { name: '三星', slug: 'samsung', patterns: [/^(三星|samsung)/i], nameOnly: true },
  { name: '原始實驗室', slug: 'primal-lab', patterns: [/原[始石](實驗室|凍乾)/] },
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
// `asName`: the text is a title or a sponsor's name, so `nameOnly` aliases count too
function aliasIn(text: string, asName = false): (typeof SPONSOR_ALIASES)[number] | null {
  let best: (typeof SPONSOR_ALIASES)[number] | null = null;
  let at = Infinity;
  for (const s of SPONSOR_ALIASES) {
    if (s.nameOnly && !asName) continue;
    for (const p of s.patterns) {
      const i = text.search(p);
      if (i !== -1 && i < at) [best, at] = [s, i];
    }
  }
  return best;
}

// Who paid for a chapter, or null when nothing says
export function sponsorOf(ch: Pick<AdChapter, 'title' | 'bullets'>): SponsorMatch | null {
  const known = (s: (typeof SPONSOR_ALIASES)[number]): SponsorMatch => ({ name: s.name, slug: s.slug, known: true });
  const title = ch.title.replace(AD_WORDS, ' ').trim();
  const byAll = ch.bullets.map((b) => SPONSORED_BY.exec(b.text)?.[1]?.trim()).filter((x): x is string => !!x);
  // The title, then who 本集由 X names, then any bullet; within one text the brand named first
  const s = aliasIn(ch.title, true) ?? aliasIn(title, true) ?? byAll.map((x) => aliasIn(x, true)).find(Boolean) ?? ch.bullets.map((b) => aliasIn(b.text)).find(Boolean);
  if (s) return known(s);
  // A long 本集由 X is usually the brand with its product and company; the title is shorter
  const name = (byAll.find((x) => x.length <= MAX_NAME) ?? title).trim();
  const slug = slugOf(name);
  if (!name || !slug || name.length > MAX_NAME) return null;
  // An English name that is an alias's slug ("Centrum") is that brand
  const alias = SPONSOR_ALIASES.find((a) => a.slug === slug);
  return alias ? known(alias) : { name, slug, known: false };
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

// By its slug, its name, or any spelling an alias knows (/sponsor/米紅生醫 from before the alias
// took the brand's own name)
export function findSponsor(index: SponsorIndex, segment: string): Sponsor | null {
  const alias = aliasIn(segment, true);
  return (
    index.bySlug.get(segment) ??
    index.bySlug.get(slugOf(segment)) ??
    [...index.bySlug.values()].find((s) => searchKey(s.name) === searchKey(segment)) ??
    (alias && index.bySlug.get(alias.slug)) ??
    null
  );
}
