// Topic pages (/topics, /topic/<category>, /topic/<category>/<item>): what the host does, plays,
// visits, watches and listens to, from the summaries' mentions (category, name, quote, time).
// Nothing is stored: like the stock pages, they are built when the index is.
//
// The summaries name one thing many ways (妮姬, 尼姬, NIKKE, 勝利女神：妮姬; Radiohead, 電台司令,
// a Radiohead song), so a mention is matched against its category's TOPIC_ALIASES first, and
// otherwise grouped by its name as searchKey gives it.
// Nothing heavy is imported here: no database, no zod.
import { urlSlug as slugOf } from './stocks.ts';

export type TopicCategory = {
  // In the URL
  slug: string;
  // mentions.category
  category: string;
  label: string;
  // What the category page says it is
  blurb: string;
};

// Every category but 其他. 家庭 is in at the owner's call (2026-11-13), parenting included.
export const TOPIC_CATEGORIES: TopicCategory[] = [
  { slug: 'sports', category: '運動', label: '運動', blurb: '主委在做、在看的運動和比賽' },
  { slug: 'games', category: '遊戲', label: '電玩', blurb: '主委在玩、在聊的遊戲和遊戲機' },
  { slug: 'travel', category: '旅遊', label: '旅遊', blurb: '主委去過、聊過的地方和飯店' },
  { slug: 'media', category: '書影音', label: '書影音', blurb: '主委在看、在聽的書、劇、電影、動畫和音樂' },
  { slug: 'food', category: '美食', label: '美食', blurb: '主委吃過、喝過的餐廳、食物和酒' },
  { slug: 'tech', category: '科技產品', label: '科技產品', blurb: '主委在用、在聊的 3C、App 和車' },
  { slug: 'family', category: '家庭', label: '家庭', blurb: '主委的家人、育兒和寵物' },
];

type Alias = { name: string; slug: string; patterns: RegExp[] };

// Per category, the names of one thing. Tried in order on the mention's name; the first
// match wins, so a narrower entry (GTA6) goes before a wider one (GTA). Add a line when a
// backfill batch brings a new spelling.
export const TOPIC_ALIASES: Record<string, Alias[]> = {
  運動: [
    { name: '功能性訓練', slug: 'functional-training', patterns: [/功能(性)?訓練/] },
    // The race, not the shoes
    { name: 'New Balance 10K', slug: 'new-balance-10k', patterns: [/^(new balance|nb) ?(10k|10 ?公里|路跑)/i] },
    { name: '跑步', slug: 'running', patterns: [/^(慢跑|跑步|10k ?跑步|五公里路跑)$/i] },
    { name: '巴西柔術', slug: 'bjj', patterns: [/柔術/] },
    { name: '拳擊', slug: 'boxing', patterns: [/^(拳擊|打拳)$/] },
    { name: '自行車', slug: 'cycling', patterns: [/^(自行車|腳踏車|騎腳踏車|兩輪腳踏車)$/] },
    { name: '重訓', slug: 'weights', patterns: [/重訓/] },
    { name: 'U-Bike', slug: 'u-bike', patterns: [/^u-?bike$/i] },
  ],
  遊戲: [
    { name: '勝利女神：妮姬', slug: 'nikke', patterns: [/妮姬|尼姬|nikke/i] },
    { name: '紅眼露比', slug: 'red-eye-ruby', patterns: [/紅[眼顏][露路鹿錄][比筆餅]|荒野路比|rubinite/i] },
    { name: 'GTA6', slug: 'gta6', patterns: [/gta ?6|gta 下一代/i] },
    { name: 'GTA', slug: 'gta', patterns: [/\bgta|俠盜獵車手/i] },
    { name: '英雄聯盟', slug: 'league-of-legends', patterns: [/英雄聯盟|league of legends|\blol\b/i] },
    { name: 'PUBG', slug: 'pubg', patterns: [/pubg|吃雞|絕地求生/i] },
    { name: '艾爾登法環', slug: 'elden-ring', patterns: [/艾爾登法環|elden ring|黃金樹幽影|法環/i] },
    { name: '寶可夢卡牌', slug: 'pokemon-cards', patterns: [/寶可夢卡/] },
    { name: '寶可夢 Mezastar', slug: 'pokemon-mezastar', patterns: [/mezastar|meta star/i] },
    { name: '死亡擱淺', slug: 'death-stranding', patterns: [/死亡擱淺|death stranding/i] },
    { name: 'RO 仙境傳說', slug: 'ragnarok-online', patterns: [/^ro\b|仙境傳說/i] },
    { name: '33號遠征隊', slug: 'expedition-33', patterns: [/(33|三三)號?遠征隊/] },
    { name: 'Bloodborne', slug: 'bloodborne', patterns: [/bloodborne|血源詛咒/i] },
    { name: 'Cyberpunk 2077', slug: 'cyberpunk-2077', patterns: [/^cyberpunk/i] },
    { name: '瑪利歐', slug: 'mario', patterns: [/馬力歐|瑪利歐/] },
    { name: '巫師', slug: 'the-witcher', patterns: [/^巫師|the witcher/i] },
    { name: 'PlayStation', slug: 'playstation', patterns: [/^(playstation|ps5)$/i] },
    { name: 'Nintendo Switch', slug: 'nintendo-switch', patterns: [/^(nintendo )?switch( 2)?$/i, /^ns2$/i] },
    { name: '楓之谷', slug: 'maplestory', patterns: [/楓之谷/] },
    { name: '遊戲王卡', slug: 'yu-gi-oh', patterns: [/遊戲王/] },
  ],
  旅遊: [
    { name: '峇里島', slug: 'bali', patterns: [/[峇巴][里釐]島/] },
    { name: '東京迪士尼', slug: 'tokyo-disney', patterns: [/東京迪士尼/] },
    { name: '台北 101', slug: 'taipei-101', patterns: [/台北 ?101/] },
    { name: '阿利坎特', slug: 'alicante', patterns: [/阿利[坎康]特/] },
    { name: '谷關虹夕諾雅', slug: 'hoshinoya-guguan', patterns: [/虹夕諾雅/] },
    { name: '羅馬競技場', slug: 'colosseum', patterns: [/^(羅馬)?競技場$/] },
  ],
  書影音: [
    { name: 'Radiohead', slug: 'radiohead', patterns: [/radiohead|電台司令/i] },
    { name: 'Oasis', slug: 'oasis', patterns: [/^oasis$/i, /^綠洲(合唱團|演唱會)?$/, /^some might say$|^wonderwall$/i] },
    { name: '葬送的芙莉蓮', slug: 'frieren', patterns: [/芙莉蓮|福利蓮/] },
    { name: '周杰倫', slug: 'jay-chou', patterns: [/周杰倫/] },
    { name: 'BIGBANG', slug: 'bigbang', patterns: [/^big ?bang( 演唱會)?$/i] },
    { name: 'G-Dragon', slug: 'g-dragon', patterns: [/^(g-dragon|gd)$/i] },
    { name: 'Måneskin', slug: 'maneskin', patterns: [/måneskin|maneskin/i] },
    { name: '鏈鋸人', slug: 'chainsaw-man', patterns: [/鏈鋸人/] },
    { name: '魔戒', slug: 'lord-of-the-rings', patterns: [/^魔戒/] },
    { name: '鬼滅之刃', slug: 'demon-slayer', patterns: [/鬼滅/] },
    { name: '秒速5公分', slug: '5-centimeters', patterns: [/秒速[5五]公分/] },
    { name: 'G.I. Joe', slug: 'gi-joe', patterns: [/g\.? ?i\.? ?joe/i] },
    { name: '極限返航', slug: 'project-hail-mary', patterns: [/極限返航|project hail mary/i] },
    { name: '楓葉姊姊', slug: 'maple-sister', patterns: [/楓葉姊|楓葉姐/] },
    { name: 'CLANNAD', slug: 'clannad', patterns: [/clannad/i] },
    { name: '五月天', slug: 'mayday', patterns: [/五月天/] },
    { name: 'Kaleo', slug: 'kaleo', patterns: [/^kaleo$/i] },
    { name: '灰階思考', slug: 'grey-thinking', patterns: [/灰[階街]思考/] },
    { name: '巴哈姆特動畫瘋', slug: 'ani-gamer', patterns: [/動畫瘋/] },
    { name: '絕命律師', slug: 'better-call-saul', patterns: [/絕命律師|better call saul/i] },
  ],
  美食: [
    { name: '皮諾可可', slug: 'pinococo', patterns: [/皮諾可可|pino ?coco|pinocc?o|^皮諾$/i] },
    { name: 'DRC 羅曼尼康帝', slug: 'drc', patterns: [/^drc$|羅曼尼康帝|romanée-conti|romanee-conti/i] },
    { name: 'Petrus 柏圖斯', slug: 'petrus', patterns: [/petrus|柏圖斯/i] },
    { name: '拉菲', slug: 'lafite', patterns: [/拉菲|lafite/i] },
    { name: 'Sassicaia', slug: 'sassicaia', patterns: [/sass?icaia|sasikaya/i] },
    { name: 'Amber Hill', slug: 'amber-hill', patterns: [/^[ae]mber hill$/i] },
    { name: 'Cask 23', slug: 'cask-23', patterns: [/cask 23/i] },
    { name: 'Takahiko', slug: 'takahiko', patterns: [/takahiko/i] },
    { name: '麥當勞', slug: 'mcdonalds', patterns: [/^麥當勞/] },
    { name: '鼎泰豐', slug: 'din-tai-fung', patterns: [/^鼎泰豐/] },
    { name: '橘色涮涮屋', slug: 'orange-shabu', patterns: [/^橘色/] },
    { name: '全聯', slug: 'pxmart', patterns: [/^全聯/] },
    { name: '十四代', slug: 'juyondai', patterns: [/^十四代/] },
    { name: '新政', slug: 'aramasa', patterns: [/^新政/] },
    { name: '7-11', slug: '7-11', patterns: [/^7-?11/] },
    { name: 'Churros', slug: 'churros', patterns: [/churros/i] },
  ],
  家庭: [
    { name: '諾亞', slug: 'noah', patterns: [/諾亞|^noah$/i] },
    // Heard as 秋口 and 秋狗
    { name: 'Choco', slug: 'choco', patterns: [/^choco$|^秋[口狗]$/i] },
    { name: 'Lisa', slug: 'lisa', patterns: [/^li[sz]a$/i] },
    // His younger son: 安哥, also written as his name 祁安 / 祈安 and as Killian
    { name: '安哥', slug: 'ange', patterns: [/^安哥$|^[祁祈]安$|^killian$/i] },
  ],
  科技產品: [
    // Before iPhone and Apple
    { name: 'Apple 折疊機', slug: 'apple-foldable', patterns: [/(apple|蘋果) ?(折疊|摺疊)|apple duo|iphone \d* ?折疊/i] },
    { name: 'iPhone', slug: 'iphone', patterns: [/^iphone/i] },
    { name: 'Apple Vision Pro', slug: 'apple-vision-pro', patterns: [/vision pro/i] },
    { name: 'AirPods', slug: 'airpods', patterns: [/^airpods/i] },
    { name: 'iPad', slug: 'ipad', patterns: [/^ipad/i] },
    { name: 'MacBook', slug: 'macbook', patterns: [/^macbook/i] },
    { name: 'ChatGPT', slug: 'chatgpt', patterns: [/^(chat)?gpt|^o3$/i] },
    { name: 'Grok', slug: 'grok', patterns: [/^grok/i] },
    { name: 'Claude', slug: 'claude', patterns: [/^claude/i] },
    { name: 'Perplexity', slug: 'perplexity', patterns: [/perplexity/i] },
    { name: 'Tesla Model X', slug: 'tesla-model-x', patterns: [/model x/i] },
    { name: 'Tesla Model Y', slug: 'tesla-model-y', patterns: [/model y/i] },
    { name: 'Tesla Model 3', slug: 'tesla-model-3', patterns: [/model 3/i] },
    { name: 'Tesla Roadster', slug: 'tesla-roadster', patterns: [/roadster/i] },
    { name: 'Porsche', slug: 'porsche', patterns: [/^porsche/i] },
    { name: 'Starlink', slug: 'starlink', patterns: [/^starlink/i] },
    { name: 'PlayStation', slug: 'playstation', patterns: [/^(ps5|playstation)/i] },
    { name: 'Nintendo Switch', slug: 'nintendo-switch', patterns: [/^(nintendo )?switch( 2)?$/i] },
    { name: 'RTX 5090', slug: 'rtx-5090', patterns: [/5090/] },
    { name: 'Garmin', slug: 'garmin', patterns: [/^garmin/i] },
    { name: 'Bose', slug: 'bose', patterns: [/^bose/i] },
    { name: 'Dyson', slug: 'dyson', patterns: [/^dyson/i] },
    { name: 'Herman Miller', slug: 'herman-miller', patterns: [/herman miller/i] },
    { name: 'Realforce', slug: 'realforce', patterns: [/realforce/i] },
    { name: 'Google Drive', slug: 'google-drive', patterns: [/google ?drive|google雲端硬碟/i] },
    { name: 'Windy', slug: 'windy', patterns: [/^windy/i] },
    { name: 'Facebook', slug: 'facebook', patterns: [/^facebook/i] },
    { name: 'YouTube', slug: 'youtube', patterns: [/^youtube/i] },
  ],
};

export type TopicRow = {
  category: string;
  name: string;
  quote: string | null;
  startSec: number;
  episodeNo: number;
  title: string;
  publishedAt: string;
  audioUrl: string;
};

export type TopicEpisode = {
  no: number;
  title: string;
  publishedAt: string;
  audioUrl: string;
  // Each mention's quote and time, with the name it was written as when that says more than
  // the item's (a Radiohead song on Radiohead's page)
  notes: { t: number; text: string }[];
};

export type TopicItem = {
  category: TopicCategory;
  slug: string;
  name: string;
  // Newest first, by date
  episodes: TopicEpisode[];
};

// category slug → item slug → item
export type TopicIndex = Map<string, Map<string, TopicItem>>;

// The item a mention belongs to, or null when its name gives no URL
export function topicOf(category: string, name: string): { slug: string; name: string | null } | null {
  const aliases = TOPIC_ALIASES[category] ?? [];
  for (const a of aliases) if (a.patterns.some((p) => p.test(name.trim()))) return { slug: a.slug, name: a.name };
  const slug = slugOf(name);
  if (!slug) return null;
  // A name that is an alias's slug (Mario for 瑪利歐) is that alias
  const alias = aliases.find((a) => a.slug === slug);
  return { slug, name: alias?.name ?? null };
}

const CATEGORY_OF = new Map(TOPIC_CATEGORIES.map((c) => [c.category, c]));

export function buildTopicIndex(rows: TopicRow[]): TopicIndex {
  const index: TopicIndex = new Map(TOPIC_CATEGORIES.map((c) => [c.slug, new Map()]));
  const groups = new Map<TopicItem, Map<string, number>>();
  const episodesOf = new Map<TopicItem, Map<number, TopicEpisode>>();
  for (const r of rows) {
    const cat = CATEGORY_OF.get(r.category);
    const m = cat && topicOf(r.category, r.name);
    if (!cat || !m) continue;
    const items = index.get(cat.slug)!;
    let item = items.get(m.slug);
    if (!item) items.set(m.slug, (item = { category: cat, slug: m.slug, name: m.name ?? r.name.trim(), episodes: [] }));
    // Without an alias, the name most of its mentions use
    let names = groups.get(item);
    if (!names) groups.set(item, (names = new Map()));
    names.set(r.name.trim(), (names.get(r.name.trim()) ?? 0) + 1);
    let eps = episodesOf.get(item);
    if (!eps) episodesOf.set(item, (eps = new Map()));
    let ep = eps.get(r.episodeNo);
    if (!ep) {
      eps.set(r.episodeNo, (ep = { no: r.episodeNo, title: r.title, publishedAt: r.publishedAt, audioUrl: r.audioUrl, notes: [] }));
      item.episodes.push(ep);
    }
    const quote = (r.quote ?? '').trim();
    const name = r.name.trim();
    // The name as written, when it says more than the item's and the quote doesn't have it
    const extra = m.name !== null && name !== m.name && !quote.includes(name) ? `（${name}）` : '';
    const text = quote ? quote + extra : name;
    if (!ep.notes.some((n) => n.t === r.startSec && n.text === text)) ep.notes.push({ t: r.startSec, text });
  }
  for (const [item, names] of groups) {
    const isAlias = (TOPIC_ALIASES[item.category.category] ?? []).some((a) => a.slug === item.slug);
    if (isAlias) item.name = TOPIC_ALIASES[item.category.category]!.find((a) => a.slug === item.slug)!.name;
    else item.name = [...names].sort((a, b) => b[1] - a[1])[0]![0];
    item.episodes.sort((a, b) => (a.publishedAt === b.publishedAt ? b.no - a.no : a.publishedAt < b.publishedAt ? 1 : -1));
    for (const e of item.episodes) e.notes.sort((a, b) => a.t - b.t);
  }
  return index;
}

// Below this an item's page is noindex and out of the sitemap; the category page lists it
// among the ones that came up once
export const TOPIC_INDEX_MIN_EPISODES = 2;

// A category's items, by how many episodes they come up in (a ranking is fine: what he plays
// or watches is not something to invest in), then the newest
export function listedTopics(index: TopicIndex, categorySlug: string): TopicItem[] {
  const newest = (i: TopicItem) => i.episodes[0]!.publishedAt;
  return [...(index.get(categorySlug)?.values() ?? [])].sort(
    (a, b) =>
      b.episodes.length - a.episodes.length ||
      (newest(a) === newest(b) ? (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0) : newest(a) < newest(b) ? 1 : -1),
  );
}

export function topicCategory(slug: string): TopicCategory | null {
  return TOPIC_CATEGORIES.find((c) => c.slug === slug) ?? null;
}

export function findTopic(index: TopicIndex, categorySlug: string, segment: string): TopicItem | null {
  const items = index.get(categorySlug);
  const cat = topicCategory(categorySlug);
  if (!items || !cat) return null;
  const m = topicOf(cat.category, segment);
  return items.get(segment) ?? (m && items.get(m.slug)) ?? null;
}

export function topicCategoryHref(c: Pick<TopicCategory, 'slug'>): string {
  return `/topic/${c.slug}`;
}

export function topicHref(i: Pick<TopicItem, 'slug' | 'category'>): string {
  return `/topic/${i.category.slug}/${encodeURIComponent(i.slug)}`;
}
