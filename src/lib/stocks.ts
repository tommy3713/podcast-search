// Stock pages (/stock/<slug>, /stocks): every episode that talks about one company or ETF.
// The rows are the summary's `stocks`, stored as mentions with category 股票. The model writes
// the same company many ways (台積電 as 2330, TSM, 2330/TSM, 2330.TW/TSM; Google under 8
// names), so rows are merged by a normalized code, or by name where there is none.
// Nothing heavy is imported here (no database, no zod): the nav and the list's search box,
// client components, read from it.
import { monthKey } from './format.ts';

// What the nav and the pages call these
export const STOCKS_LABEL = '個股';

// Pages below this many episodes exist (an episode links to them) but are noindex and
// left out of /stocks and the sitemap: one line about a company is too thin a page
export const STOCK_LIST_MIN_EPISODES = 2;

// ADRs and second share classes go with the listing the host talks about, and codes the
// model wrote without their exchange get it back
const CODE_ALIASES: Record<string, string> = {
  TSM: '2330',
  GOOG: 'GOOGL',
  NTDOY: '7974.T',
  '7974': '7974.T',
  '9984': '9984.T',
  IFNNY: 'IFX.DE',
  IFX: 'IFX.DE',
  '6857': '6857.T',
  '6702': '6702.T',
  '002475': '002475.SZ',
};

// Names without a code that are the same company as another name. Keys and values are as
// nameKey gives them (NFKC, lower case); a value that has a code elsewhere joins that code.
const NAME_ALIASES: Record<string, string> = {
  '安世半導體': 'nexperia',
  'nexperia 安世半導體': 'nexperia',
  'anduril industries': 'anduril',
  '字節跳動': 'bytedance',
  'xai(grok)': 'xai',
  'x(twitter)': 'twitter',
  'nitto boseki': '日東紡',
};

// Codes the summaries don't give yet: a company that listed after most of its episodes, whose
// rows have a name and no code. Keys as nameKey gives them.
const NAME_CODES: Record<string, string> = {
  spacex: 'SPCX',
};

const CODE_SHAPE = /^[0-9A-Z][0-9A-Z.-]{0,11}$/;

// "2330.TW/TSM" → "2330", "tsm" → "2330", "5347.TWO" → "5347". null: nothing usable.
export function canonicalCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const first = raw
    .normalize('NFKC')
    .toUpperCase()
    .split(/[/,、\s]+/)
    .find(Boolean);
  if (!first) return null;
  const code = first.replace(/\.TWO?$/, '');
  if (!CODE_SHAPE.test(code)) return null;
  return CODE_ALIASES[code] ?? code;
}

export type Market = 'tw' | 'us' | 'other' | 'none';
export const MARKET_LABELS: Record<Market, string> = {
  tw: '台股',
  us: '美股',
  other: '其他市場',
  none: '未上市或沒有代號',
};

function marketOf(code: string | null): Market {
  if (!code) return 'none';
  // 2330, 0050, 00631L, 006208
  if (/^\d{4,6}[A-Z]?$/.test(code)) return 'tw';
  // NVDA, BRK.B. Not IQE.L: other one-letter suffixes are exchanges.
  if (/^[A-Z]{1,5}(\.[AB])?$/.test(code)) return 'us';
  return 'other';
}

// Full-width forms and case don't make a different company: "GROQ" / "Groq"
function nameKey(name: string): string {
  const nk = name.normalize('NFKC').trim().toLowerCase();
  return NAME_ALIASES[nk] ?? nk;
}

// A name or URL segment that is a code and nothing else: "NVDA", not "ON／STM" or "AI 概念股",
// whose first word canonicalCode would take
function wholeCode(s: string): string | null {
  return /[/,、\s]/.test(s.normalize('NFKC').trim()) ? null : canonicalCode(s);
}

// The code as the pages show it beside the name: not when the name already is the code
export function shownCode(stock: Pick<Stock, 'name' | 'code'>): string | null {
  return stock.code && stock.code !== stock.name.toUpperCase() ? stock.code : null;
}

// Without a code, an industry, an index or "some ETF" is not something to give a page
const GENERIC_NAME = /(產業|大盤|概念股|族群|類股|指數|國債|台指期|相關標的|產品|龍頭)$|ETF/i;

export type StockRow = {
  name: string;
  code: string | null;
  detail: string | null;
  startSec: number;
  episodeNo: number;
  title: string;
  publishedAt: string;
  audioUrl: string;
};

export type StockNote = { t: number; text: string };
export type StockEpisode = {
  no: number;
  title: string;
  publishedAt: string;
  audioUrl: string;
  notes: StockNote[];
  // Titles of the chapters the notes fall in, in order: what he was talking about
  chapters: string[];
  // The summary's bullets that name the company, beyond the notes
  points: StockNote[];
  // He dwelt on it, rather than naming it in passing: it is in a chapter title or a key
  // point, or several bullets name it. How much he said, never what he thought.
  deep: boolean;
};

// What a stock's page needs of an episode's summary
export type EpisodeOutline = {
  chapters: { t: number; title: string; ad: boolean; bullets: StockNote[] }[];
  keys: StockNote[];
};

const MAX_POINTS = 4;

// How close a bullet must be to a note to be the same passage said twice
const SAME_PASSAGE_SEC = 20;

// Summary texts are matched against every stock of their episode: normalised once per build
type Normalise = (text: string) => string;
function normaliser(): Normalise {
  const seen = new Map<string, string>();
  return (text) => {
    let n = seen.get(text);
    if (n === undefined) seen.set(text, (n = text.normalize('NFKC').toLowerCase()));
    return n;
  };
}

// Whether a text names the company by any of the names its rows use. Latin names need word
// ends ("Meta" is not in "metaverse"); codes are left out, since NET, NOW and ON are words,
// and so is a row's name that is just the code. A short Chinese name still matches inside a
// longer one (長榮 in 長榮航空): there is no word end to check.
function nameMatcher(names: Iterable<string>, code: string | null, norm: Normalise): (text: string) => boolean {
  const parts = new Set<string>();
  for (const n of names) {
    if (code && canonicalCode(n) === code && wholeCode(n)) continue;
    for (const part of n.normalize('NFKC').toLowerCase().split(/[/()]/)) if (part.trim().length >= 2) parts.add(part.trim());
  }
  const tests = [...parts].map((part) =>
    /^[\x20-\x7e]+$/.test(part)
      ? new RegExp(`(?<![a-z0-9])${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`)
      : { test: (t: string) => t.includes(part) },
  );
  return (text) => {
    const t = norm(text);
    return tests.some((x) => x.test(t));
  };
}

// Fills in an episode's chapters, points and depth from its summary
function outlineEpisode(ep: StockEpisode, outline: EpisodeOutline | undefined, named: (text: string) => boolean): void {
  if (!outline) return;
  for (const n of ep.notes) {
    // A note inside an ad chapter has no chapter, rather than the one before the ad
    const c = outline.chapters.findLast((c) => c.t <= n.t);
    if (c && !c.ad && c.title && !ep.chapters.includes(c.title)) ep.chapters.push(c.title);
  }
  const bullets = outline.chapters.filter((c) => !c.ad).flatMap((c) => c.bullets).filter((b) => named(b.text));
  // The summary times a stock's note and the bullet on the same passage separately
  ep.points = bullets.filter((b) => !ep.notes.some((n) => Math.abs(n.t - b.t) <= SAME_PASSAGE_SEC)).slice(0, MAX_POINTS);
  ep.deep = ep.chapters.some(named) || outline.keys.some((k) => named(k.text)) || bullets.length >= 2;
}
export type Stock = {
  // The last path segment of its page, not URL-encoded: the code, or the name in lower case
  // (not as the newest episode spells it, so the URL stays where it is)
  slug: string;
  name: string;
  code: string | null;
  market: Market;
  // Newest first, by date: a re-uploaded episode's number can be out of step with its date
  episodes: StockEpisode[];
  // The other names and codes its rows came with (TSMC／台積電, TSM), for the list's search
  aliases: string[];
};

export type StockIndex = {
  byKey: Map<string, Stock>;
  // name → the code that name most often comes with
  nameCodes: Map<string, string>;
  // Every code with a page
  codes: Set<string>;
};

function mostCommon<T>(counts: Map<T, number>): T | undefined {
  let best: T | undefined;
  let n = 0;
  // Ties go to the first one seen, which is from the newest episode
  for (const [k, c] of counts) if (c > n) [best, n] = [k, c];
  return best;
}

function bump<K>(counts: Map<K, number>, k: K): void {
  counts.set(k, (counts.get(k) ?? 0) + 1);
}

// "c:2330" for a code, "n:openai" for a name, null for a row that gets no page
function keyOf(name: string, code: string | null, codes: Set<string>, nameCodes: Map<string, string>): string | null {
  const c = canonicalCode(code);
  if (c) return `c:${c}`;
  const nk = nameKey(name);
  if (!nk) return null;
  // The same name has a code in another episode (三星 → 005930.KS), or is one (a row named NVDA)
  const known = nameCodes.get(nk);
  if (known) return `c:${known}`;
  const asCode = wholeCode(name);
  if (asCode && codes.has(asCode)) return `c:${asCode}`;
  // "/" can't be one path segment
  if (GENERIC_NAME.test(nk) || nk.includes('/')) return null;
  return `n:${nk}`;
}

// `outlines`: episode number → its summary; without one an episode has just its notes
export function buildStockIndex(rows: StockRow[], outlines: Map<number, EpisodeOutline> = new Map()): StockIndex {
  const codes = new Set<string>();
  const codesOfName = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const c = canonicalCode(r.code);
    if (!c) continue;
    codes.add(c);
    const nk = nameKey(r.name);
    let counts = codesOfName.get(nk);
    if (!counts) codesOfName.set(nk, (counts = new Map()));
    bump(counts, c);
  }
  const nameCodes = new Map<string, string>(Object.entries(NAME_CODES));
  for (const code of nameCodes.values()) codes.add(code);
  // A code the rows themselves give a name wins over the table
  for (const [nk, counts] of codesOfName) nameCodes.set(nk, mostCommon(counts)!);

  const groups = new Map<string, { names: Map<string, number>; rawCodes: Set<string>; episodes: Map<number, StockEpisode> }>();
  for (const r of rows) {
    const key = keyOf(r.name, r.code, codes, nameCodes);
    if (!key) continue;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { names: new Map(), rawCodes: new Set(), episodes: new Map() }));
    bump(g.names, r.name.trim());
    for (const c of (r.code ?? '').normalize('NFKC').toUpperCase().split(/[/,、\s]+/)) if (CODE_SHAPE.test(c)) g.rawCodes.add(c);
    let ep = g.episodes.get(r.episodeNo);
    if (!ep) g.episodes.set(r.episodeNo, (ep = { no: r.episodeNo, title: r.title, publishedAt: r.publishedAt, audioUrl: r.audioUrl, notes: [], chapters: [], points: [], deep: false }));
    const text = (r.detail ?? '').trim();
    // Two spellings of one company in an episode often carry the same note
    if (!ep.notes.some((n) => n.text === text)) ep.notes.push({ t: r.startSec, text });
  }

  const byKey = new Map<string, Stock>();
  const norm = normaliser();
  for (const [key, g] of groups) {
    const code = key.startsWith('c:') ? key.slice(2) : null;
    const name = mostCommon(g.names)!;
    const episodes = [...g.episodes.values()].sort((a, b) => (a.publishedAt === b.publishedAt ? b.no - a.no : a.publishedAt < b.publishedAt ? 1 : -1));
    const named = nameMatcher(g.names.keys(), code, norm);
    for (const e of episodes) {
      e.notes.sort((a, b) => a.t - b.t);
      outlineEpisode(e, outlines.get(e.no), named);
    }
    const aliases = [...g.names.keys(), ...g.rawCodes].filter((a) => a !== name && a !== code);
    byKey.set(key, { slug: key.slice(2), name, code, market: marketOf(code), episodes, aliases });
  }
  return { byKey, nameCodes, codes };
}

// The page for a summary's stock, or null when it has none
export function stockFor(index: StockIndex, name: string, code: string | null): Stock | null {
  const key = keyOf(name, code, index.codes, index.nameCodes);
  return key ? (index.byKey.get(key) ?? null) : null;
}

// The page a URL segment (decoded) names. Forgiving: /stock/tsm, /stock/openai and
// /stock/三星 find their page, whose canonical URL is the slug.
export function findStock(index: StockIndex, segment: string): Stock | null {
  const c = wholeCode(segment);
  const nk = nameKey(segment);
  const named = index.nameCodes.get(nk);
  return (c && index.byKey.get(`c:${c}`)) || index.byKey.get(`n:${nk}`) || (named && index.byKey.get(`c:${named}`)) || null;
}

export function stockHref(stock: Stock): string {
  return `/stock/${encodeURIComponent(stock.slug)}`;
}

const MARKET_ORDER: Market[] = ['tw', 'us', 'other', 'none'];

// What /stocks and the sitemap list: by market, then by code or name. Never by how often
// the host talks about something, which would read as a ranking.
// `min` 1 gives every page, which is what the search box on /stocks looks through.
export function listedStocks(index: StockIndex, min = STOCK_LIST_MIN_EPISODES): { market: Market; stocks: Stock[] }[] {
  const listed = [...index.byKey.values()].filter((s) => s.episodes.length >= min);
  return MARKET_ORDER.map((market) => ({
    market,
    stocks: listed.filter((s) => s.market === market).sort(byCodeOrName),
  })).filter((g) => g.stocks.length > 0);
}

function byCodeOrName(a: Stock, b: Stock): number {
  return a.code && b.code ? (a.code < b.code ? -1 : 1) : a.name.localeCompare(b.name, 'zh-Hant');
}

export const CO_MENTIONED_MAX = 12;
const CO_MENTIONED_MIN_SHARED = 3;

// 同一集也提到: the listed pages that most often come up in the same episodes as this one.
// Chosen by overlap relative to both pages' sizes (shared / either), since by plain count
// 輝達 and 台積電 would be on every page; shown in the list's order, without the numbers,
// so it doesn't read as a ranking.
// Kept per index: it only changes when the index is rebuilt, and crawlers ask for every page.
const coMentionedOf = new WeakMap<StockIndex, Map<Stock, Stock[]>>();

export function coMentioned(index: StockIndex, stock: Stock): Stock[] {
  let known = coMentionedOf.get(index);
  if (!known) coMentionedOf.set(index, (known = new Map()));
  let found = known.get(stock);
  if (!found) known.set(stock, (found = findCoMentioned(index, stock)));
  return found;
}

function findCoMentioned(index: StockIndex, stock: Stock): Stock[] {
  const mine = new Set(stock.episodes.map((e) => e.no));
  const scored: { other: Stock; score: number }[] = [];
  for (const other of index.byKey.values()) {
    if (other === stock || other.episodes.length < STOCK_LIST_MIN_EPISODES) continue;
    const shared = other.episodes.filter((e) => mine.has(e.no)).length;
    if (shared >= CO_MENTIONED_MIN_SHARED) scored.push({ other, score: shared / (mine.size + other.episodes.length - shared) });
  }
  return scored
    .sort((a, b) => b.score - a.score || (a.other.slug < b.other.slug ? -1 : 1))
    .slice(0, CO_MENTIONED_MAX)
    .map((x) => x.other)
    .sort((a, b) => MARKET_ORDER.indexOf(a.market) - MARKET_ORDER.indexOf(b.market) || byCodeOrName(a, b));
}

// The question the 問 AI link on a stock's page fills in on /ask. About what he said, not
// whether to buy (the answer's rules are the Q&A prompt's), and without 最近: for a stock
// whose episodes are old, a search scoped to recent days would find nothing.
export function stockQuestion(stock: Pick<Stock, 'name'>): string {
  return `主委談過${stock.name}的什麼？`;
}

// A name as one URL segment: as searchKey gives it, spaces as dashes. '' when nothing is left
// that a URL can carry. For sponsor and topic pages.
export function urlSlug(name: string): string {
  const slug = searchKey(name).replace(/\s+/g, '-').replace(/[/?#%\\]/g, '');
  return /^[.-]*$/.test(slug) ? '' : slug;
}

// How the search box on /stocks compares: no case, no full-width forms
export function searchKey(s: string): string {
  return s.normalize('NFKC').trim().toLowerCase();
}

// Everything a page can be found by, one per line: 台 and TSMC find 台積電, 006208 finds 富邦台50.
// The slug too, which an alias can make a name no row spells (安世半導體 → nexperia).
export function stockSearchText(stock: Stock): string {
  return [...new Set([stock.name, stock.code ?? '', stock.slug, ...stock.aliases].map(searchKey))].filter(Boolean).join('\n');
}

// `key`: the query through searchKey. It matches when it is part of any of those; an empty
// one matches nothing.
export function stockMatches(searchText: string, key: string): boolean {
  return key !== '' && searchText.includes(key);
}

// `episodes`: live episodes that month. 0 means the site doesn't have that month (not
// backfilled), which is not the same as a month he didn't bring the company up.
export type StockMonth = { key: string; mentioned: number; episodes: number };

// "2026-08" → "2026 年 8 月"
export function monthKeyLabel(key: string): string {
  return `${key.slice(0, 4)} 年 ${Number(key.slice(5))} 月`;
}

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
// Months since year 0, so a span is a plain range
const monthIndex = (key: string) => Number(key.slice(0, 4)) * 12 + Number(key.slice(5)) - 1;
const monthOfIndex = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;

// One entry per month from the site's oldest episode to its newest, oldest first, so every
// stock's chart covers the same span. `liveMonths`: monthKey → live episodes in it; a key
// from a date that didn't parse is left out.
export function stockMonths(stock: { episodes: { publishedAt: string }[] }, liveMonths: Map<string, number>): StockMonth[] {
  const keys = [...liveMonths.keys()].filter((k) => MONTH_KEY.test(k)).sort();
  if (keys.length === 0) return [];
  const mentioned = new Map<string, number>();
  for (const e of stock.episodes) bump(mentioned, monthKey(e.publishedAt));
  const months: StockMonth[] = [];
  for (let i = monthIndex(keys[0]!); i <= monthIndex(keys.at(-1)!); i++) {
    const key = monthOfIndex(i);
    months.push({ key, mentioned: mentioned.get(key) ?? 0, episodes: liveMonths.get(key) ?? 0 });
  }
  return months;
}

// What the chart draws: a month, a calendar quarter or a year
export type ChartBar = {
  label: string;
  year: string;
  mentioned: number;
  episodes: number;
  // The newest month in it with a mention: where the bar links to, the list being newest first
  target: string | null;
};

export const CHART_MAX_BARS = 30;

// Bars stay wide enough to see and tap on a phone however far back backfill goes: months
// while they fit, then quarters, then years.
export function chartBars(months: StockMonth[]): ChartBar[] {
  const step = months.length <= CHART_MAX_BARS ? 1 : months.length <= CHART_MAX_BARS * 3 ? 3 : 12;
  const bars = new Map<number, ChartBar>();
  for (const m of months) {
    const [y, mo] = [m.key.slice(0, 4), Number(m.key.slice(5))];
    const bucket = Math.floor(monthIndex(m.key) / step);
    let bar = bars.get(bucket);
    if (!bar) {
      const from = Math.floor((mo - 1) / step) * step + 1;
      const label = step === 1 ? monthKeyLabel(m.key) : step === 3 ? `${y} 年 ${from}–${from + 2} 月` : `${y} 年`;
      bars.set(bucket, (bar = { label, year: y, mentioned: 0, episodes: 0, target: null }));
    }
    bar.mentioned += m.mentioned;
    bar.episodes += m.episodes;
    if (m.mentioned > 0) bar.target = m.key;
  }
  return [...bars.values()];
}
