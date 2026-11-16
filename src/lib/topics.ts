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
  // Where its items come from: the summaries' mentions (the default), or the transcripts (節日,
  // which the summaries don't keep as mentions)
  source?: 'transcript';
};

// Every mention category but 其他, then 節日. 家庭 is in at the owner's call (2026-11-13), parenting included.
export const TOPIC_CATEGORIES: TopicCategory[] = [
  { slug: 'sports', category: '運動', label: '運動', blurb: '主委在做、在看的運動和比賽' },
  { slug: 'games', category: '遊戲', label: '電玩', blurb: '主委在玩、在聊的遊戲和遊戲機' },
  { slug: 'travel', category: '旅遊', label: '旅遊', blurb: '主委去過、聊過的地方和飯店' },
  { slug: 'media', category: '書影音', label: '書影音', blurb: '主委在看、在聽的書、劇、電影、動畫和音樂' },
  { slug: 'food', category: '美食', label: '美食', blurb: '主委吃過、喝過的餐廳、食物和酒' },
  { slug: 'tech', category: '科技產品', label: '科技產品', blurb: '主委在用、在聊的 3C、App 和車' },
  { slug: 'family', category: '家庭', label: '家庭', blurb: '主委的家人、育兒和寵物' },
  // Not a mention category: built from the transcripts by holidays.ts (owner's call, 2026-11-14)
  { slug: 'holidays', category: '節日', label: '節日', blurb: '節目裡聊到的節日：怎麼過、聊了什麼', source: 'transcript' },
];

export type Holiday = { name: string; slug: string; terms: string[] };

// The holidays with a page, and the words that name each in a transcript. Looked for in the
// transcript, where 新年 is mostly listeners' 新年快樂 and doesn't say which new year, so it isn't
// one; 雙11 is left out, being nearly all ads. Every word here was checked in the transcripts
// for what it also catches (過年 in 抱股過年 is the holiday too).
export const HOLIDAYS: Holiday[] = [
  { name: '跨年', slug: 'new-years-eve', terms: ['跨年', '元旦'] },
  { name: '農曆新年', slug: 'lunar-new-year', terms: ['過年', '春節', '農曆新年', '除夕'] },
  { name: '情人節', slug: 'valentines-day', terms: ['情人節', '七夕'] },
  { name: '母親節', slug: 'mothers-day', terms: ['母親節'] },
  { name: '端午節', slug: 'dragon-boat-festival', terms: ['端午'] },
  { name: '父親節', slug: 'fathers-day', terms: ['父親節'] },
  { name: '中秋節', slug: 'mid-autumn-festival', terms: ['中秋'] },
  { name: '萬聖節', slug: 'halloween', terms: ['萬聖', 'halloween'] },
  { name: '聖誕節', slug: 'christmas', terms: ['聖誕', '耶誕', 'christmas'] },
];

export function holidayPattern(h: Holiday): RegExp {
  return new RegExp(h.terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
}

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
    { name: '自行車', slug: 'cycling', patterns: [/^(自行車|腳踏車|騎腳踏車|兩輪腳踏車|單車)$/] },
    { name: '單車環島', slug: 'cycling-round-taiwan', patterns: [/^(單車|騎腳踏車|自行車)環島$/] },
    { name: '重訓', slug: 'weights', patterns: [/重訓|重量訓練/] },
    { name: 'U-Bike', slug: 'u-bike', patterns: [/^(u-?bike|youbike)$/i] },
    { name: '大魯閣', slug: 'taroko-batting', patterns: [/^大魯閣/] },
    { name: '高爾夫', slug: 'golf', patterns: [/^高爾夫球?$/] },
    { name: '歐洲盃', slug: 'euro', patterns: [/^歐洲[盃杯]$/] },
    { name: '百岳', slug: 'baiyue', patterns: [/^(台灣)?百岳$/] },
    { name: '武嶺', slug: 'wuling', patterns: [/^武嶺/] },
    { name: 'WBC', slug: 'wbc', patterns: [/^wbc/i] },
    { name: '釣魚', slug: 'fishing', patterns: [/^(野?溪釣(魚)?|釣魚)$/] },
    { name: '羽球', slug: 'badminton', patterns: [/^羽(毛)?球(賽)?$/] },
    { name: 'Messi', slug: 'messi', patterns: [/^(messi|梅西)$/i] },
    { name: 'Dwight Howard', slug: 'dwight-howard', patterns: [/dwight howard/i] },
    { name: '黑山羊', slug: 'black-goat', patterns: [/^黑山羊/] },
  ],
  遊戲: [
    { name: '勝利女神：妮姬', slug: 'nikke', patterns: [/妮姬|尼姬|nikke/i] },
    { name: '紅眼露比', slug: 'red-eye-ruby', patterns: [/紅[眼顏][露路鹿錄][比筆餅]|荒野路比|rubinite/i] },
    { name: 'GTA6', slug: 'gta6', patterns: [/gta ?6|gta 下一代/i] },
    { name: 'GTA', slug: 'gta', patterns: [/\bgta|俠盜獵車手/i] },
    { name: '英雄聯盟', slug: 'league-of-legends', patterns: [/英雄聯盟|league of legends|\blol\b/i] },
    { name: 'PUBG', slug: 'pubg', patterns: [/pubg|吃雞|絕地求生/i] },
    { name: '艾爾登法環', slug: 'elden-ring', patterns: [/艾爾登法環|elden ring|黃金樹幽影|法環|老頭環/i] },
    { name: '寶可夢卡牌', slug: 'pokemon-cards', patterns: [/寶可夢卡/] },
    { name: '寶可夢 Mezastar', slug: 'pokemon-mezastar', patterns: [/mezastar|meta star/i] },
    { name: '死亡擱淺', slug: 'death-stranding', patterns: [/死亡擱淺|death stranding/i] },
    { name: 'RO 仙境傳說', slug: 'ragnarok-online', patterns: [/^ro\b|仙境傳說/i] },
    { name: '33號遠征隊', slug: 'expedition-33', patterns: [/(33|三三)號?遠征隊/] },
    { name: 'Bloodborne', slug: 'bloodborne', patterns: [/bloodborne|血源詛咒/i] },
    { name: 'Cyberpunk 2077', slug: 'cyberpunk-2077', patterns: [/^cyberpunk|^電馭叛客/i] },
    { name: '瑪利歐', slug: 'mario', patterns: [/[馬瑪][力利莉]歐/] },
    { name: '巫師', slug: 'the-witcher', patterns: [/^巫師|the witcher/i] },
    { name: '世紀帝國', slug: 'age-of-empires', patterns: [/世紀帝國|帝國時代|^世紀 ?[1-4一二三四]$|age of empires/i] },
    { name: '薩爾達傳說', slug: 'zelda', patterns: [/薩爾達|曠野之息|王國之淚|zelda/i] },
    { name: '碧血狂殺', slug: 'red-dead-redemption', patterns: [/碧血狂殺|red dead|^rdr ?2?$/i] },
    { name: '文明帝國', slug: 'civilization', patterns: [/^文明(帝國|系列|六|\s*civilization)|^civilization/i] },
    { name: '尼爾：自動人形', slug: 'nier-automata', patterns: [/尼爾.?自動人形|nier/i, /^2b(公仔)?$/i] },
    { name: '上古卷軸', slug: 'elder-scrolls', patterns: [/上古[卷捲]軸|elder scrolls|skyrim/i] },
    { name: '女神異聞錄', slug: 'persona', patterns: [/女神異聞錄|^persona/i] },
    { name: '暗黑破壞神', slug: 'diablo', patterns: [/^暗黑(破壞神)?\s*[1-4二三四]?$|^diablo/i] },
    { name: '心跳文學社', slug: 'doki-doki', patterns: [/[心星]跳文學社|doki doki/i] },
    { name: '夏日狂想曲', slug: 'summer-memories', patterns: [/^[夏冬]日狂想曲/] },
    { name: '夏色四葉草', slug: 'natsuiro', patterns: [/^[夏下]色四葉草/] },
    { name: '隻狼', slug: 'sekiro', patterns: [/隻狼|sekiro/i] },
    { name: '霍格華茲的傳承', slug: 'hogwarts-legacy', patterns: [/霍格華茲的?傳承/] },
    { name: '底特律：變人', slug: 'detroit', patterns: [/底特律.?變人/] },
    { name: '博德之門3', slug: 'baldurs-gate-3', patterns: [/[博柏]德之門/] },
    { name: '劍星', slug: 'stellar-blade', patterns: [/^劍星|stellar blade/i] },
    { name: '隔壁太太', slug: 'neighbor-wife', patterns: [/^隔壁太太/] },
    { name: '魔獸爭霸', slug: 'warcraft', patterns: [/^魔獸爭霸/] },
    { name: 'Overwatch', slug: 'overwatch', patterns: [/^overwatch|鬥陣特攻/i] },
    { name: '快打旋風', slug: 'street-fighter', patterns: [/^快打旋風/] },
    { name: 'Call of Duty', slug: 'call-of-duty', patterns: [/^call of duty|決勝時刻/i] },
    { name: 'Final Fantasy', slug: 'final-fantasy', patterns: [/^final fantasy|太空戰士|最終幻想/i] },
    { name: '模擬市民', slug: 'the-sims', patterns: [/^模擬市民|the sims/i] },
    { name: '騎馬與砍殺', slug: 'mount-and-blade', patterns: [/騎馬與砍殺|mount & blade/i] },
    { name: 'Microsoft Flight Simulator', slug: 'flight-simulator', patterns: [/flight simulator|^模擬飛行$/i] },
    { name: '紅色警戒', slug: 'red-alert', patterns: [/^紅色警戒/] },
    { name: 'Fallout', slug: 'fallout', patterns: [/^fallout/i] },
    { name: 'Helldivers', slug: 'helldivers', patterns: [/helldivers|絕地戰兵/i] },
    { name: 'Counter-Strike', slug: 'counter-strike', patterns: [/^(cs2?|counter-strike)$/i] },
    { name: '魔物獵人', slug: 'monster-hunter', patterns: [/^魔物獵人/] },
    { name: '天堂', slug: 'lineage', patterns: [/^天堂(m|經典服)?$/i] },
    { name: 'Pokémon GO', slug: 'pokemon-go', patterns: [/^pok[eé]mon ?go$/i] },
    { name: '格鬥天王', slug: 'king-of-fighters', patterns: [/^格鬥天王/] },
    { name: 'Gameworks', slug: 'gameworks', patterns: [/^gam(e)?works$/i] },
    { name: '異星工廠', slug: 'factorio', patterns: [/異星工廠|factorio/i] },
    { name: '魂系遊戲', slug: 'soulslike', patterns: [/^(類)?魂系(遊戲)?$|^類魂遊戲$/] },
    { name: '小島秀夫', slug: 'hideo-kojima', patterns: [/^小島秀夫/] },
    { name: '宮崎英高', slug: 'miyazaki', patterns: [/^宮崎英高/] },
    { name: 'Xbox', slug: 'xbox', patterns: [/^xbox|^game pass$/i] },
    { name: 'Weiss Schwarz', slug: 'weiss-schwarz', patterns: [/^ws卡?$|weiss schwarz/i] },
    { name: 'PlayStation', slug: 'playstation', patterns: [/^(playstation( 5| pro)?|ps[3-6]?( pro)?)$/i] },
    { name: 'Nintendo Switch', slug: 'nintendo-switch', patterns: [/^(nintendo )?switch( 2)?$/i, /^ns2$/i] },
    { name: '楓之谷', slug: 'maplestory', patterns: [/楓之谷/] },
    { name: '遊戲王卡', slug: 'yu-gi-oh', patterns: [/遊戲王/] },
  ],
  旅遊: [
    { name: '峇里島', slug: 'bali', patterns: [/[峇巴][里釐黎]島/] },
    { name: '東京迪士尼', slug: 'tokyo-disney', patterns: [/東京迪士尼/] },
    { name: '台北 101', slug: 'taipei-101', patterns: [/台北 ?101/] },
    { name: '阿利坎特', slug: 'alicante', patterns: [/阿利[坎康]特/] },
    { name: '谷關虹夕諾雅', slug: 'hoshinoya-guguan', patterns: [/虹夕諾雅/] },
    { name: '羅馬競技場', slug: 'colosseum', patterns: [/^(羅馬)?競技場$/] },
    { name: 'AYANA', slug: 'ayana', patterns: [/^ayana/i] },
    { name: '澳洲打工度假', slug: 'working-holiday-australia', patterns: [/^澳洲打工/] },
    { name: '成田機場', slug: 'narita', patterns: [/^成田(機場)?$/] },
    { name: '羽田機場', slug: 'haneda', patterns: [/^羽田(機場)?$/] },
    { name: 'The Datai', slug: 'the-datai', patterns: [/datai/i] },
    { name: '林口 Outlet', slug: 'linkou-outlet', patterns: [/^林口 ?outlet$/i] },
    { name: '洛杉磯', slug: 'los-angeles', patterns: [/^(洛杉磯|la)$/i] },
    { name: 'The Hyundai Seoul', slug: 'the-hyundai-seoul', patterns: [/hyundai seoul/i] },
    { name: 'Terme di Saturnia', slug: 'saturnia', patterns: [/saturnia/i] },
    { name: 'Bergen', slug: 'bergen', patterns: [/^bergen$|^伯根/i] },
    { name: '斯德哥爾摩', slug: 'stockholm', patterns: [/斯德哥爾摩$/] },
    { name: '羅馬機場', slug: 'fiumicino', patterns: [/fiumicino|李奧納多達文西機場/i] },
    { name: '中華航空', slug: 'china-airlines', patterns: [/^(華航|中華航空)$/] },
    { name: '司馬庫斯', slug: 'smangus', patterns: [/^[司斯]馬庫斯$/] },
    { name: '倫敦', slug: 'london', patterns: [/^(英國)?倫敦$/] },
    { name: '迎風狗公園', slug: 'yingfeng-dog-park', patterns: [/迎風狗公園$/] },
    { name: '中央公園', slug: 'central-park', patterns: [/^(美國|紐約)?中央公園$/] },
    { name: '小琉球', slug: 'xiaoliuqiu', patterns: [/^(屏東)?小琉球$/] },
  ],
  書影音: [
    { name: 'Radiohead', slug: 'radiohead', patterns: [/radiohead|電台司令/i] },
    { name: 'Oasis', slug: 'oasis', patterns: [/^oasis( |$)/i, /^綠洲(合唱團|演唱會)?$/, /^some might say$|^wonderwall$/i] },
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
    { name: '會計思考', slug: 'accounting-thinking', patterns: [/^會計的?思考$/] },
    // The Netflix series; the game is 巫師 under 遊戲
    { name: '獵魔士', slug: 'the-witcher-series', patterns: [/獵魔士|^巫師|the witcher/i] },
    { name: "Don't Look Up", slug: 'dont-look-up', patterns: [/^don.t look up$|千萬別抬頭/i] },
    { name: '敏迪', slug: 'mindy', patterns: [/^敏迪/] },
    { name: '捍衛戰士', slug: 'top-gun', patterns: [/^top gun|^捍衛戰士/i] },
    // The app, not the podcasts on it (a name's 'podcast' is otherwise dropped)
    { name: 'Apple Podcasts', slug: 'apple-podcasts', patterns: [/^apple podcasts?/i] },
    { name: 'Coldplay', slug: 'coldplay', patterns: [/^coldplay/i] },
    { name: '碳變', slug: 'altered-carbon', patterns: [/碳變|altered carbon/i] },
    // 百靈果 NEWS, heard as 白靈果
    { name: '百靈果', slug: 'bailingguo', patterns: [/[百白]靈果/] },
    { name: 'Joe Rogan', slug: 'joe-rogan', patterns: [/joe rogan/i] },
    { name: '星際效應', slug: 'interstellar', patterns: [/^(星際效應|interstellar)$/i] },
    { name: '絕命毒師', slug: 'breaking-bad', patterns: [/^(絕命毒師|breaking bad)/i] },
    { name: '權力遊戲', slug: 'game-of-thrones', patterns: [/^(權力遊戲|game of thrones)/i] },
    { name: '冰與火之歌', slug: 'song-of-ice-and-fire', patterns: [/^冰與火(之歌)?$/] },
    { name: '紙房子', slug: 'money-heist', patterns: [/紙房子|^la casa de papel/i] },
    { name: '后翼棄兵', slug: 'queens-gambit', patterns: [/^[后後]翼棄兵/] },
    { name: '性愛自修室', slug: 'sex-education', patterns: [/性愛自修室|^sex education/i] },
    { name: '鹿角男孩', slug: 'sweet-tooth', patterns: [/鹿角男孩|^sweet tooth/i] },
    { name: '陌生的孩子', slug: 'changeling', patterns: [/陌生的孩子|^changeling/i] },
    { name: '紅色通緝令', slug: 'red-notice', patterns: [/^紅色[通追]緝令$|^red notice$/i] },
    { name: '末日光明', slug: 'see', patterns: [/^(末日光明 ?)?see$/i] },
    { name: '教父', slug: 'the-godfather', patterns: [/^教父(系列)?$/] },
    { name: 'Disney+', slug: 'disney-plus', patterns: [/^disney ?(\+|plus)$/i] },
    { name: 'Prime Video', slug: 'prime-video', patterns: [/^(amazon )?prime video$/i] },
    { name: 'HBO', slug: 'hbo', patterns: [/^hbo( max)?$/i] },
    { name: '莎拉布萊曼', slug: 'sarah-brightman', patterns: [/^(莎拉布萊曼|sarah brightman)$/i] },
    { name: 'Maroon 5', slug: 'maroon-5', patterns: [/^(maroon 5|魔力紅)$/i] },
    { name: '哆啦A夢', slug: 'doraemon', patterns: [/哆啦a夢|^小叮噹$/i] },
    { name: '86－不存在的戰區－', slug: '86-eighty-six', patterns: [/^86.?不存在的戰區/] },
    { name: '黑袍糾察隊', slug: 'the-boys', patterns: [/^黑袍糾察隊/] },
    { name: 'Cyberpunk: Edgerunners', slug: 'cyberpunk-edgerunners', patterns: [/edgerunners|^cyberpunk$/i] },
    { name: '(G)I-DLE', slug: 'g-idle', patterns: [/^\(?g\)?[.-]?i-?dle/i] },
    { name: 'Cocomelon', slug: 'cocomelon', patterns: [/^coco ?melon$/i] },
    { name: 'Lex Fridman', slug: 'lex-fridman', patterns: [/^lex (fridman|freeman)/i] },
    { name: 'Theo Von', slug: 'theo-von', patterns: [/^theo von/i] },
    { name: 'Ben Shapiro', slug: 'ben-shapiro', patterns: [/^ben shapiro/i] },
    { name: 'Bill Burr', slug: 'bill-burr', patterns: [/^bill burr/i] },
    { name: 'Dave Chappelle', slug: 'dave-chappelle', patterns: [/^dave chappelle/i] },
    { name: 'Shane Gillis', slug: 'shane-gillis', patterns: [/^shane gillis/i] },
    { name: 'Jordan Peterson', slug: 'jordan-peterson', patterns: [/^jordan peterson/i] },
    { name: '國動', slug: 'guodong', patterns: [/^國動/] },
    { name: '博恩', slug: 'brian-tseng', patterns: [/^曾?博恩/] },
    { name: '台通', slug: 'taitong', patterns: [/^台通/] },
    { name: '老高', slug: 'mr-and-mrs-gao', patterns: [/^老高/] },
    { name: '啾啾鞋', slug: 'chuchushoe', patterns: [/^啾啾鞋/] },
    { name: '先知瑪莉', slug: 'mary-see-the-future', patterns: [/mary see the future|^先知瑪莉/i] },
    { name: '薩泰爾', slug: 'satire', patterns: [/^薩泰爾?$/] },
    { name: 'MULA', slug: 'mula', patterns: [/^mula/i] },
    { name: 'Pan Piano', slug: 'pan-piano', patterns: [/^pan ?piano$/i] },
    { name: 'J.K. Rowling', slug: 'jk-rowling', patterns: [/^j\.? ?k\.? rowling$/i] },
    { name: '從前，有個好萊塢', slug: 'once-upon-a-time-in-hollywood', patterns: [/^從前，?有個好萊塢$/] },
    // Taleb's book; 黑天鵝 alone may be the film
    { name: '黑天鵝效應', slug: 'the-black-swan', patterns: [/^黑天鵝效應$/] },
    { name: '曼達洛人', slug: 'the-mandalorian', patterns: [/mandalorian|曼達洛人/i] },
    { name: '當幸福來敲門', slug: 'pursuit-of-happyness', patterns: [/^當?幸福來敲門$/] },
    { name: '靈魂急轉彎', slug: 'soul', patterns: [/^(soul|靈魂急轉彎)$/i] },
    { name: '一級玩家', slug: 'ready-player-one', patterns: [/^(一級玩家|ready player one)$/i] },
    { name: 'Maid', slug: 'maid', patterns: [/^(maid|女傭浮生路)$/i] },
  ],
  美食: [
    { name: '皮諾可可', slug: 'pinococo', patterns: [/皮諾可可|pino ?coco|pinocc?h?(io)?( ?coco)?$|pinocc?o|^皮諾$/i] },
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
    { name: 'Churros', slug: 'churros', patterns: [/churros|吉拿棒/i] },
    { name: '多力多滋', slug: 'doritos', patterns: [/多[力利]多[滋茲]|^doritos/i] },
    { name: 'In-N-Out', slug: 'in-n-out', patterns: [/^in-n-out/i] },
    { name: 'Smith & Wollensky', slug: 'smith-and-wollensky', patterns: [/^smith & wol?l?[ea]nsky$/i] },
    { name: 'Odari Jip', slug: 'odari-jip', patterns: [/^odari ?j(ee|i)p$/i] },
    { name: '香圓', slug: 'xiangyuan', patterns: [/^(苗栗)?香[圓園](客家小館)?$/] },
    { name: '水上人家', slug: 'shuishang-renjia', patterns: [/^水上人家/] },
    { name: '真味醬蟹', slug: 'zhenwei-crab', patterns: [/^(真味)?醬蟹$|^真味(食堂|醬蟹)/] },
    { name: '威力炸醬麵', slug: 'weili-zhajiangmian', patterns: [/^[威唯]力炸醬麵$/] },
    { name: '五十嵐', slug: '50lan', patterns: [/^(五十嵐|50嵐)$/] },
    { name: '加分豆花', slug: 'jiafen-douhua', patterns: [/加分豆花/] },
    { name: '金莎', slug: 'ferrero-rocher', patterns: [/^金[莎沙](巧克力)?$/] },
    { name: '珍寶海鮮', slug: 'jumbo-seafood', patterns: [/^珍寶(海鮮)?$/] },
    { name: 'Alpiani', slug: 'alpiani', patterns: [/^a[il]piani$/i] },
    { name: '零卡可樂', slug: 'coke-zero', patterns: [/^(零卡可樂|zero cola|coke zero)$/i] },
  ],
  家庭: [
    { name: '諾亞', slug: 'noah', patterns: [/諾亞|^noah$/i] },
    // Heard as 秋口 and 秋狗
    { name: 'Choco', slug: 'choco', patterns: [/^choco$|^秋[口狗葛]$|^丘口$/i] },
    { name: 'Lisa', slug: 'lisa', patterns: [/^li[sz]a$|^麗莎$/i] },
    { name: '林口美國學校', slug: 'linkou-american-school', patterns: [/^(林口)?美國學校$/] },
    { name: '台北歐洲學校', slug: 'taipei-european-school', patterns: [/^(台北)?歐洲學校$/] },
    // His younger son: 安哥, also written as his name 祁安 / 祈安 and as Killian
    { name: '安哥', slug: 'ange', patterns: [/^安哥$|^[祁祈]安$|^killian$/i] },
  ],
  // So /topic/holidays/萬聖節 finds its page
  節日: HOLIDAYS.map((h) => ({ name: h.name, slug: h.slug, patterns: [holidayPattern(h)] })),
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
    { name: 'Tesla', slug: 'tesla', patterns: [/^(tesla|特斯拉)( ?(電動車|汽車))?$/i] },
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
    { name: 'Google Drive', slug: 'google-drive', patterns: [/google ?drive|google ?雲端硬碟/i] },
    { name: 'Windy', slug: 'windy', patterns: [/^windy/i] },
    { name: 'Facebook', slug: 'facebook', patterns: [/^(facebook|臉書)/i] },
    { name: 'YouTube', slug: 'youtube', patterns: [/^youtube/i] },
    { name: 'Telegram', slug: 'telegram', patterns: [/^telegram/i] },
    { name: 'LINE', slug: 'line', patterns: [/^line( ?群組| ?貼圖)?$/i] },
    { name: 'Apple Podcasts', slug: 'apple-podcasts', patterns: [/^apple podcasts?/i] },
    { name: 'TikTok', slug: 'tiktok', patterns: [/^(tiktok|抖音)/i] },
    { name: 'Google 翻譯', slug: 'google-translate', patterns: [/^google ?翻譯$/i] },
    { name: 'RODE 麥克風', slug: 'rode', patterns: [/^(rode ?)?nt-usb$|^rode/i] },
    { name: 'Kobo', slug: 'kobo', patterns: [/^(樂天 ?)?[kc]obo/i] },
    { name: 'Ray-Ban Stories', slug: 'ray-ban-stories', patterns: [/^ray-?ban/i] },
    { name: 'GeForce NOW', slug: 'geforce-now', patterns: [/geforce ?now|^nvidia gfn$/i] },
    { name: 'Oculus', slug: 'oculus', patterns: [/^oculus/i] },
    { name: 'Midjourney', slug: 'midjourney', patterns: [/^mid ?journey$/i] },
    { name: 'RTX 4090', slug: 'rtx-4090', patterns: [/rtx ?4090/i] },
    { name: 'Copilot', slug: 'copilot', patterns: [/copilot/i] },
    { name: 'Amazon Alexa', slug: 'amazon-alexa', patterns: [/^amazon alexa/i] },
    { name: 'NotebookLM', slug: 'notebooklm', patterns: [/notebooklm/i] },
    { name: '籌碼K線', slug: 'chip-k', patterns: [/籌碼k/i] },
    { name: 'Wine-Searcher', slug: 'wine-searcher', patterns: [/^wine-?searcher$/i] },
    { name: 'Instagram', slug: 'instagram', patterns: [/^(instagram|ig)$/i] },
    // Named X since 2023; mentions from before say Twitter or 推特
    { name: 'X', slug: 'x', patterns: [/^(x|x ?平台|twitter|推特|x ?[／/(（] ?twitter[)）]?)$/i] },
    { name: 'Google 地圖', slug: 'google-maps', patterns: [/^google ?(maps?|地圖)$/i] },
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

export type TopicNote = { t: number; text: string; quoted: boolean; as?: string };

export type TopicEpisode = {
  no: number;
  title: string;
  publishedAt: string;
  audioUrl: string;
  // What the episode was about, in a line: the quotes alone are short
  line: string;
  // Each mention: its time and the host's words (`quoted`), or just the name when the summary
  // kept no words; `as`, the name it was written as when that says more than the item's (a
  // Radiohead song on Radiohead's page), kept apart from the words
  notes: TopicNote[];
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
// A name as the item compares it: a title the summary put wholly in 《》 is the bare title
// (《反脆弱》, 反脆弱)
export function bareName(name: string): string {
  return name.trim().replace(/^《\s*([^《》]+?)\s*》$/, '$1');
}

// What a name says the item is, without what it adds: a note in （）(Dwight Howard（魔獸）),
// a second name after ／ (Fortnite／要塞英雄), and for 書影音 the song in 〈〉 or the show it
// came up in (Coldplay〈Gravity〉, Taylor Swift 演唱會, Joe Rogan 的節目). Never shorter than
// two characters.
export function baseName(category: string, raw: string): string {
  const keep = (from: string, to: string) => (to.trim().length >= 2 ? to.trim() : from);
  let n = bareName(raw);
  n = keep(n, n.replace(/\s*[（(][^（）()]+[）)]$/, ''));
  // Two names of one thing: ／ unless both sides are short (AC／DC), / only between scripts
  const [a, b] = n.split(/\s*[／/]\s*/);
  const cjk = (x: string) => /[㐀-鿿]/.test(x);
  if (b !== undefined && (n.includes('／') ? a!.length > 2 || b.length > 2 : cjk(a!) !== cjk(b))) n = keep(n, bareName(a!));
  if (category === '書影音') {
    n = keep(n, n.replace(/\s*〈[^〈〉]+〉$/, ''));
    n = keep(n, n.replace(/\s*(的\s*)?(新專輯|節目|脫口秀|stand[- ]?up)$/i, ''));
    n = keep(n, n.replace(/(['’]s)?\s*(的\s*)?podcast$/i, ''));
    // A concert by someone: the name is three characters or Latin (張學友, Coldplay), not 跨年
    const concert = n.match(/^(.+?)\s*(日本|東京|台北|高雄)?\s*(演唱會|演奏會|場)$/);
    if (concert && (concert[3] !== '場' || concert[2]) && (concert[1]!.length >= 3 || /[a-z]/i.test(concert[1]!))) n = concert[1]!;
  }
  return n;
}

// `base`: the name the item goes by when no alias names it
export function topicOf(category: string, raw: string): { slug: string; name: string | null; base: string } | null {
  const name = bareName(raw);
  const base = baseName(category, raw);
  const aliases = TOPIC_ALIASES[category] ?? [];
  for (const a of aliases) if (a.patterns.some((p) => p.test(base))) return { slug: a.slug, name: a.name, base: a.name };
  // Then the whole name, from its start only (Apple Podcast, not Apple), so a note in （） or a
  // second name can't take the mention elsewhere
  if (name !== base) for (const a of aliases) if (a.patterns.some((p) => name.search(p) === 0)) return { slug: a.slug, name: a.name, base: a.name };
  const slug = slugOf(base);
  if (!slug) return null;
  // A name that is an alias's slug (Mario for 瑪利歐) is that alias
  const alias = aliases.find((a) => a.slug === slug);
  return { slug, name: alias?.name ?? null, base: alias?.name ?? base };
}

// An item's episodes: newest first, by date
export function newestFirst(a: Pick<TopicEpisode, 'no' | 'publishedAt'>, b: Pick<TopicEpisode, 'no' | 'publishedAt'>): number {
  return a.publishedAt === b.publishedAt ? b.no - a.no : a.publishedAt < b.publishedAt ? 1 : -1;
}

const CATEGORY_OF = new Map(TOPIC_CATEGORIES.map((c) => [c.category, c]));

// `lines`: episode number → its one-line summary
export function buildTopicIndex(rows: TopicRow[], lines: Map<number, string> = new Map()): TopicIndex {
  const index: TopicIndex = new Map(TOPIC_CATEGORIES.map((c) => [c.slug, new Map()]));
  const groups = new Map<TopicItem, Map<string, number>>();
  const episodesOf = new Map<TopicItem, Map<number, TopicEpisode>>();
  for (const r of rows) {
    const cat = CATEGORY_OF.get(r.category);
    const m = cat && topicOf(r.category, r.name);
    if (!cat || !m) continue;
    const items = index.get(cat.slug)!;
    let item = items.get(m.slug);
    if (!item) items.set(m.slug, (item = { category: cat, slug: m.slug, name: m.base, episodes: [] }));
    // The name most of its mentions go by
    let names = groups.get(item);
    if (!names) groups.set(item, (names = new Map()));
    names.set(m.base, (names.get(m.base) ?? 0) + 1);
    let eps = episodesOf.get(item);
    if (!eps) episodesOf.set(item, (eps = new Map()));
    let ep = eps.get(r.episodeNo);
    if (!ep) {
      eps.set(r.episodeNo, (ep = { no: r.episodeNo, title: r.title, publishedAt: r.publishedAt, audioUrl: r.audioUrl, line: lines.get(r.episodeNo) ?? '', notes: [] }));
      item.episodes.push(ep);
    }
    const quote = (r.quote ?? '').trim();
    const name = bareName(r.name);
    // The name as written, when it says more than the item's and the quote doesn't have it
    const as = name !== m.base && !quote.includes(name) ? name : undefined;
    const note: TopicNote = quote ? { t: r.startSec, text: quote, quoted: true, ...(as ? { as } : {}) } : { t: r.startSec, text: name, quoted: false };
    if (!ep.notes.some((n) => n.t === note.t && n.text === note.text)) ep.notes.push(note);
  }
  for (const [item, names] of groups) {
    // An alias item's rows all give the alias's name
    item.name = [...names].sort((a, b) => b[1] - a[1])[0]![0];
    item.episodes.sort(newestFirst);
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

// 同一集也提到: the items (of any category, with a page) that come up in the same episodes as
// this one, the ones sharing most first. A ranking is fine: none of them is an investment.
export const CO_TOPICS_MAX = 10;

// Kept per index: it only changes when the index is rebuilt, and crawlers ask for every page
const coTopicsOf = new WeakMap<TopicIndex, Map<TopicItem, TopicItem[]>>();

export function coTopics(index: TopicIndex, item: TopicItem): TopicItem[] {
  let known = coTopicsOf.get(index);
  if (!known) coTopicsOf.set(index, (known = new Map()));
  let found = known.get(item);
  if (!found) known.set(item, (found = findCoTopics(index, item)));
  return found;
}

function findCoTopics(index: TopicIndex, item: TopicItem): TopicItem[] {
  const mine = new Set(item.episodes.map((e) => e.no));
  // A thing in many episodes shares one with nearly everything: ask for two then
  const least = item.episodes.length >= 4 ? 2 : 1;
  const found: { other: TopicItem; shared: number }[] = [];
  for (const items of index.values()) {
    for (const other of items.values()) {
      if (other === item || other.episodes.length < TOPIC_INDEX_MIN_EPISODES) continue;
      const shared = other.episodes.filter((e) => mine.has(e.no)).length;
      if (shared >= least) found.push({ other, shared });
    }
  }
  return found
    .sort((a, b) => {
      // Items of two categories can share a slug: the href tells them apart
      const [ha, hb] = [topicHref(a.other), topicHref(b.other)];
      return b.shared - a.shared || b.other.episodes.length - a.other.episodes.length || (ha < hb ? -1 : ha > hb ? 1 : 0);
    })
    .slice(0, CO_TOPICS_MAX)
    .map((x) => x.other);
}

// The question the 問 AI link on an item's page fills in on /ask
export function topicQuestion(item: Pick<TopicItem, 'name'>): string {
  return `主委怎麼談${item.name}？`;
}
