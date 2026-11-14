import { describe, expect, it } from 'vitest';
import { openDb } from '@/lib/db.ts';
import { topicRows } from '@/lib/stock-pages.ts';
import { buildTopicIndex, coTopics, findTopic, listedTopics, type TopicRow, topicCategory, topicHref, topicOf, topicQuestion } from '@/lib/topics.ts';

const row = (episodeNo: number, category: string, name: string, quote = `${name} 的事`, startSec = 60, publishedAt = `2026-01-${String(episodeNo % 28 || 28).padStart(2, '0')}T12:00:00Z`): TopicRow => ({
  category,
  name,
  quote,
  startSec,
  episodeNo,
  title: '⭐',
  publishedAt,
  audioUrl: `https://audio.example/${episodeNo}.mp3`,
});

describe('topicOf', () => {
  // Every name below is one the summaries really have
  it('joins the names of one thing', () => {
    for (const n of ['勝利女神：妮姬', '妮姬', '尼姬', 'NIKKE', 'Nikke', '妮姬櫻花']) expect(topicOf('遊戲', n)?.slug).toBe('nikke');
    for (const n of ['紅眼露比', '紅顏路比', '紅眼鹿餅', 'Rubinite／荒野路比']) expect(topicOf('遊戲', n)?.slug).toBe('red-eye-ruby');
    for (const n of ['Radiohead', '電台司令', 'Radiohead〈No Surprises〉', 'Radiohead 東京場']) expect(topicOf('書影音', n)?.slug).toBe('radiohead');
    for (const n of ['峇里島', '巴里島', '巴釐島', '峇里島AYANA']) expect(topicOf('旅遊', n)?.slug).toBe('bali');
    for (const n of ['功能性訓練', '功能訓練']) expect(topicOf('運動', n)?.slug).toBe('functional-training');
  });

  it('joins the spellings of a restaurant, a wine and a gadget', () => {
    for (const n of ['皮諾可可', 'Pinococo', 'Pino Coco', 'Pinocco', 'Pinococo 松露野菇燉飯']) expect(topicOf('美食', n)?.slug).toBe('pinococo');
    for (const n of ['DRC', '羅曼尼康帝']) expect(topicOf('美食', n)?.slug).toBe('drc');
    for (const n of ['Petrus', '柏圖斯']) expect(topicOf('美食', n)?.slug).toBe('petrus');
    for (const n of ['Apple 折疊機', '蘋果摺疊機 Duo', 'Apple Duo', 'iPhone 18 折疊']) expect(topicOf('科技產品', n)?.slug).toBe('apple-foldable');
    for (const n of ['iPhone', 'iPhone Pro Max', 'iPhone 17 Pro Max']) expect(topicOf('科技產品', n)?.slug).toBe('iphone');
    for (const n of ['Model X Plaid', 'Tesla Model X Plaid', 'Tesla Model X']) expect(topicOf('科技產品', n)?.slug).toBe('tesla-model-x');
    for (const n of ['ChatGPT', 'GPT', 'GPT-4o', 'O3']) expect(topicOf('科技產品', n)?.slug).toBe('chatgpt');
    for (const n of ['諾亞', 'Noah', '謝諾亞']) expect(topicOf('家庭', n)?.slug).toBe('noah');
    for (const n of ['Choco', '秋口', '秋狗']) expect(topicOf('家庭', n)?.slug).toBe('choco');
    for (const n of ['安哥', '祁安', '祈安', 'Killian']) expect(topicOf('家庭', n)?.slug).toBe('ange');
  });

  it('keeps a narrower name before a wider one', () => {
    expect(topicOf('遊戲', 'GTA6')?.slug).toBe('gta6');
    expect(topicOf('遊戲', 'GTA 下一代')?.slug).toBe('gta6');
    expect(topicOf('遊戲', 'GTA5')?.slug).toBe('gta');
    expect(topicOf('遊戲', '俠盜獵車手')?.slug).toBe('gta');
  });

  it('keeps the shoes, other arenas, other OASIS and Switch games out of what they aren’t', () => {
    expect(topicOf('運動', 'New Balance 10K')?.slug).toBe('new-balance-10k');
    expect(topicOf('運動', 'NB路跑')?.slug).toBe('new-balance-10k');
    expect(topicOf('運動', 'New Balance 跑鞋')?.slug).toBe('new-balance-跑鞋');
    expect(topicOf('旅遊', '羅馬競技場')?.slug).toBe('colosseum');
    expect(topicOf('旅遊', '東京奧運競技場')?.slug).toBe('東京奧運競技場');
    expect(topicOf('書影音', '綠洲合唱團')?.slug).toBe('oasis');
    expect(topicOf('書影音', '一級玩家的綠洲')?.slug).not.toBe('oasis');
    expect(topicOf('遊戲', 'Nintendo Switch 2')?.slug).toBe('nintendo-switch');
    expect(topicOf('遊戲', 'Switch Sports')?.slug).toBe('switch-sports');
  });

  it('names a name that is an alias’s slug by the alias', () => {
    expect(topicOf('遊戲', 'Mario')).toEqual({ slug: 'mario', name: '瑪利歐' });
    const index = buildTopicIndex([row(713, '遊戲', 'Mario'), row(712, '遊戲', '瑪利歐')]);
    expect(findTopic(index, 'games', 'mario')!.name).toBe('瑪利歐');
  });

  it('keeps the name a mention was written as when it says more than the item’s', () => {
    const index = buildTopicIndex([
      row(707, '書影音', 'Radiohead 東京場', '抽到了演唱會門票', 2289),
      row(707, '書影音', 'Radiohead', '第一次認識', 116),
      row(706, '書影音', '電台司令', '電台司令的新歌', 50),
    ]);
    const r = findTopic(index, 'media', 'radiohead')!;
    expect(r.episodes[0]!.notes).toEqual([
      { t: 116, text: '第一次認識', quoted: true },
      { t: 2289, text: '抽到了演唱會門票', quoted: true, as: 'Radiohead 東京場' },
    ]);
    expect(r.episodes[1]!.notes).toEqual([{ t: 50, text: '電台司令的新歌', quoted: true }]);
    // No words kept: the bare name, not passed off as a quote
    const bare = buildTopicIndex([{ ...row(1, '運動', '網球'), quote: '' }]);
    expect(findTopic(bare, 'sports', '網球')!.episodes[0]!.notes).toEqual([{ t: 60, text: '網球', quoted: false }]);
  });

  it('pages anything else by its name, and gives no page to a name a URL can’t carry', () => {
    expect(topicOf('運動', '網球')).toEqual({ slug: '網球', name: null });
    expect(topicOf('運動', 'Pickle Ball')).toEqual({ slug: 'pickle-ball', name: null });
    expect(topicOf('旅遊', '///')).toBeNull();
    // An alias of one category is not used in another
    expect(topicOf('運動', '妮姬')?.slug).toBe('妮姬');
  });
});

describe('buildTopicIndex', () => {
  const index = buildTopicIndex([
    row(713, '運動', '網球', '什麼時候要報名網球比賽', 1923, '2026-11-11T04:00:00Z'),
    row(712, '運動', '網球', '打了一場網球', 300, '2026-11-07T04:00:00Z'),
    row(712, '運動', '網球', '網球拍斷了', 900, '2026-11-07T04:00:00Z'),
    row(700, '運動', '慢跑', '早上去慢跑', 50, '2026-09-27T04:00:00Z'),
    row(699, '運動', '跑步', '跑步跑了十公里', 70, '2026-09-24T04:00:00Z'),
    row(713, '遊戲', '尼姬', '新角色', 100, '2026-11-11T04:00:00Z'),
    row(713, '家庭', '諾亞', '小孩發燒', 500, '2026-11-11T04:00:00Z'),
    // Categories without pages are left out
    row(713, '其他', '林口', '搬到林口', 800, '2026-11-11T04:00:00Z'),
  ]);

  it('gives each thing its episodes, newest first, with every mention in an episode', () => {
    const tennis = findTopic(index, 'sports', '網球')!;
    expect(tennis.episodes.map((e) => e.no)).toEqual([713, 712]);
    expect(tennis.episodes[1]!.notes).toEqual([
      { t: 300, text: '打了一場網球', quoted: true },
      { t: 900, text: '網球拍斷了', quoted: true },
    ]);
    expect(findTopic(index, 'sports', 'running')!.episodes.map((e) => e.no)).toEqual([700, 699]);
  });

  it('names an alias by its own name, and anything else by the name most mentions use', () => {
    expect(findTopic(index, 'games', 'nikke')!.name).toBe('勝利女神：妮姬');
    expect(findTopic(index, 'games', '尼姬')!.slug).toBe('nikke');
    expect(findTopic(index, 'sports', '網球')!.name).toBe('網球');
  });

  it('leaves the categories without pages out', () => {
    expect([...index.keys()]).toEqual(['sports', 'games', 'travel', 'media', 'food', 'tech', 'family', 'holidays']);
    expect([...index.values()].flatMap((m) => [...m.values()]).some((i) => i.name === '林口')).toBe(false);
    expect(findTopic(index, 'family', 'noah')!.name).toBe('諾亞');
  });

  it('lists a category by how many episodes, and links items under it', () => {
    expect(listedTopics(index, 'sports').map((i) => i.slug)).toEqual(['網球', 'running']);
    expect(listedTopics(index, 'nope')).toEqual([]);
    expect(topicHref(findTopic(index, 'sports', '網球')!)).toBe(`/topic/sports/${encodeURIComponent('網球')}`);
    expect(topicCategory('games')?.label).toBe('電玩');
    expect(topicCategory('family')?.label).toBe('家庭');
    expect(topicCategory('other')).toBeNull();
    expect(findTopic(index, 'nope', '網球')).toBeNull();
  });
});

describe('topicRows', () => {
  it('reads live episodes’ mentions in the topic categories only', () => {
    const db = openDb(':memory:', { migrate: true });
    const ep = db.prepare(`INSERT INTO episodes (episode_no, guid, title, published_at, audio_url, status) VALUES (?, ?, '⭐', ?, 'https://x', ?)`);
    const mention = db.prepare('INSERT INTO mentions (episode_id, category, name, code, detail, quote, start_sec) VALUES (?, ?, ?, NULL, NULL, ?, ?)');
    const live = ep.run(713, 'g713', '2026-11-11T04:00:00Z', 'done').lastInsertRowid;
    const failed = ep.run(714, 'g714', '2026-11-14T04:00:00Z', 'failed').lastInsertRowid;
    mention.run(live, '運動', '網球', '報名比賽', 1923);
    mention.run(live, '其他', '林口', '搬家', 10);
    mention.run(live, '股票', '台積電', null, 20);
    mention.run(failed, '運動', '網球', '還沒上線', 5);
    expect(topicRows(db)).toEqual([
      { category: '運動', name: '網球', quote: '報名比賽', startSec: 1923, episodeNo: 713, title: '⭐', publishedAt: '2026-11-11T04:00:00Z', audioUrl: 'https://x' },
    ]);
  });
});

describe('an item page', () => {
  const index = buildTopicIndex([
    ...[1, 2, 3, 4, 5].map((n) => row(n, '運動', '網球')),
    ...[1, 2, 3].map((n) => row(n, '運動', '泰拳')),
    ...[2, 3].map((n) => row(n, '遊戲', '妮姬')),
    // Shares one episode with 網球: too few for a thing in five episodes
    ...[5, 9].map((n) => row(n, '旅遊', '日本')),
    // Has no page of its own
    row(1, '美食', '拉麵'),
  ]);

  it('lists what comes up in the same episodes, of any category, most shared first', () => {
    const tennis = findTopic(index, 'sports', '網球')!;
    expect(coTopics(index, tennis).map((i) => i.name)).toEqual(['泰拳', '勝利女神：妮姬']);
    // A thing in fewer episodes takes one shared episode
    expect(coTopics(index, findTopic(index, 'travel', '日本')!).map((i) => i.name)).toEqual(['網球']);
  });

  it('gives the same order every time, even for two items with one slug in two categories', () => {
    const twins = buildTopicIndex([
      ...[1, 2, 3, 4].map((n) => row(n, '運動', '網球')),
      ...[1, 2].map((n) => row(n, '遊戲', 'Switch')),
      ...[1, 2].map((n) => row(n, '科技產品', 'Switch')),
    ]);
    const tennis = findTopic(twins, 'sports', '網球')!;
    expect(coTopics(twins, tennis).map((i) => topicHref(i))).toEqual(['/topic/games/nintendo-switch', '/topic/tech/nintendo-switch']);
    // Kept with the index
    expect(coTopics(twins, tennis)).toBe(coTopics(twins, tennis));
  });

  it('asks about what he said', () => {
    expect(topicQuestion({ name: '網球' })).toBe('主委怎麼談網球？');
  });

  it('carries what each episode was about', () => {
    const withLine = buildTopicIndex([row(713, '運動', '網球'), row(712, '運動', '網球')], new Map([[713, '聊台灣遊戲投資']]));
    expect(findTopic(withLine, 'sports', '網球')!.episodes.map((e) => e.line)).toEqual(['聊台灣遊戲投資', '']);
  });
});
