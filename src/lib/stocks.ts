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
};

export type StockNote = { t: number; text: string };
export type StockEpisode = { no: number; title: string; publishedAt: string; notes: StockNote[] };
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

export function buildStockIndex(rows: StockRow[]): StockIndex {
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
  const nameCodes = new Map<string, string>();
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
    if (!ep) g.episodes.set(r.episodeNo, (ep = { no: r.episodeNo, title: r.title, publishedAt: r.publishedAt, notes: [] }));
    const text = (r.detail ?? '').trim();
    // Two spellings of one company in an episode often carry the same note
    if (!ep.notes.some((n) => n.text === text)) ep.notes.push({ t: r.startSec, text });
  }

  const byKey = new Map<string, Stock>();
  for (const [key, g] of groups) {
    const code = key.startsWith('c:') ? key.slice(2) : null;
    const name = mostCommon(g.names)!;
    const episodes = [...g.episodes.values()].sort((a, b) => (a.publishedAt === b.publishedAt ? b.no - a.no : a.publishedAt < b.publishedAt ? 1 : -1));
    for (const e of episodes) e.notes.sort((a, b) => a.t - b.t);
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
    stocks: listed
      .filter((s) => s.market === market)
      .sort((a, b) => (a.code && b.code ? (a.code < b.code ? -1 : 1) : a.name.localeCompare(b.name, 'zh-Hant'))),
  })).filter((g) => g.stocks.length > 0);
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
export function stockMonths(stock: Stock, liveMonths: Map<string, number>): StockMonth[] {
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
