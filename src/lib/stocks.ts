// Stock pages (/stock/<slug>, /stocks): every episode that talks about one company or ETF.
// The rows are the summary's `stocks`, stored as mentions with category 股票. The model writes
// the same company many ways (台積電 as 2330, TSM, 2330/TSM, 2330.TW/TSM; Google under 8
// names), so rows are merged by a normalized code, or by name where there is none.
// Nothing is imported here: the nav, a client component on every page, reads the label.

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
  if (!/^[0-9A-Z][0-9A-Z.-]{0,11}$/.test(code)) return null;
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
  // Newest first
  episodes: StockEpisode[];
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

  const groups = new Map<string, { names: Map<string, number>; episodes: Map<number, StockEpisode> }>();
  for (const r of rows) {
    const key = keyOf(r.name, r.code, codes, nameCodes);
    if (!key) continue;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { names: new Map(), episodes: new Map() }));
    bump(g.names, r.name.trim());
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
    const episodes = [...g.episodes.values()].sort((a, b) => b.no - a.no);
    for (const e of episodes) e.notes.sort((a, b) => a.t - b.t);
    byKey.set(key, { slug: key.slice(2), name, code, market: marketOf(code), episodes });
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
export function listedStocks(index: StockIndex): { market: Market; stocks: Stock[] }[] {
  const listed = [...index.byKey.values()].filter((s) => s.episodes.length >= STOCK_LIST_MIN_EPISODES);
  return MARKET_ORDER.map((market) => ({
    market,
    stocks: listed
      .filter((s) => s.market === market)
      .sort((a, b) => (a.code && b.code ? (a.code < b.code ? -1 : 1) : a.name.localeCompare(b.name, 'zh-Hant'))),
  })).filter((g) => g.stocks.length > 0);
}
