import { describe, expect, it } from 'vitest';
import { openDb } from '@/lib/db.ts';
import {
  type AdChapter,
  averageGapDays,
  buildSponsorIndex,
  findSponsor,
  listedSponsors,
  spanPosition,
  sponsorHref,
  sponsorOf,
} from '@/lib/sponsors.ts';
import { adChapters } from '@/lib/stock-pages.ts';

const ad = (episodeNo: number, title: string, bullets: string[], publishedAt = `2026-01-${String(episodeNo % 28 || 28).padStart(2, '0')}T12:00:00Z`): AdChapter => ({
  episodeNo,
  episodeTitle: '⭐',
  publishedAt,
  audioUrl: `https://audio.example/${episodeNo}.mp3`,
  title,
  t: 0,
  bullets: bullets.map((text, i) => ({ t: i * 20, text })),
});

describe('sponsorOf', () => {
  // Every chapter below is one the summaries really have
  it('knows a brand by any spelling the transcript gives it', () => {
    expect(sponsorOf(ad(707, 'NordVPN業配', ['NordVPN可連到超過100個國家']))?.name).toBe('NordVPN');
    expect(sponsorOf(ad(697, 'NordVPN 業配', ['…']))?.slug).toBe('nordvpn');
    for (const title of ['Sally業配', 'Saily業配', 'Sally eSIM業配', 'Saily出國網路']) expect(sponsorOf(ad(1, title, []))?.name).toBe('Saily');
    // The title names the product; the bullets the brand, misheard
    expect(sponsorOf(ad(713, '開場業配', ['本集由 Duck 的情緒贊助，主委以雙十一檔期語氣介紹活動。']))?.name).toBe('Dr.情趣');
    expect(sponsorOf(ad(657, '開場業配', ['本集由台灣萊雅集團旗下醫學美容品牌修力可贊助']))?.name).toBe('修麗可');
    for (const t of ['米紅生醫業配', '米鴻生醫業配', '咪哄生醫業配']) expect(sponsorOf(ad(1, t, []))?.slug).toBe('mihong');
  });

  it('takes the brand from 本集由 X 贊助 when the title names only the product', () => {
    expect(sponsorOf(ad(702, '明星三缺一', ['本集由明星三缺一贊助，主委說盤看再久不會多賺']))?.name).toBe('明星三缺一');
    expect(sponsorOf(ad(692, '台啤業配', ['本集由台灣啤酒贊助，介紹台啤雲泡生啤酒']))?.name).toBe('台灣啤酒');
    expect(sponsorOf(ad(675, '綠藤業配', ['本期由綠藤生機贊助']))?.name).toBe('綠藤生機');
  });

  it('falls back to the title when 本集由 names a company and a product at length, or nothing', () => {
    expect(sponsorOf(ad(595, '免稅預購業配', ['本集由長榮航空 EVA Sky Shop 免稅預購網贊助，主打出發前 15 天']))?.name).toBe('免稅預購');
    expect(sponsorOf(ad(560, '業配：木質地圖', ['主委說買房成家後']))?.name).toBe('木質地圖');
    expect(sponsorOf(ad(710, '防滑業配', ['防滑劑用於浴室']))?.name).toBe('防滑');
  });

  it('keeps a pitch with its own brand when it names another in passing', () => {
    expect(sponsorOf(ad(1, 'Saily業配', ['由 NordVPN 團隊推出的 eSIM']))?.slug).toBe('saily');
    // In one text, the brand named first
    expect(sponsorOf(ad(1, '開場業配', ['Saily 跟 NordVPN 是同一家公司']))?.slug).toBe('saily');
    // Latin names as words: chosen is not OSEN
    expect(sponsorOf(ad(1, '開場業配', ['本集由 Chosen 贊助']))?.name).toBe('Chosen');
  });

  it('reads past the words a title uses for an ad, and an English alias slug is that brand', () => {
    expect(sponsorOf(ad(1, '中段業配：防滑', []))?.name).toBe('防滑');
    expect(sponsorOf(ad(1, '業配時間', []))).toBeNull();
    expect(sponsorOf(ad(1, '開場廣告', []))).toBeNull();
    expect(sponsorOf(ad(1, '///業配', []))).toBeNull();
    expect(sponsorOf(ad(1, '...', []))).toBeNull();
    expect(sponsorOf(ad(1, 'Centrum業配', []))).toEqual({ name: '善存', slug: 'centrum', known: true });
  });

  it('has nothing when no part of the chapter names anyone', () => {
    expect(sponsorOf(ad(1, '開場業配', ['主委用台指期夜盤帶出產品']))).toBeNull();
    expect(sponsorOf(ad(1, '業配', []))).toBeNull();
  });
});

describe('buildSponsorIndex', () => {
  const index = buildSponsorIndex([
    ad(707, 'NordVPN業配', ['可連到 100 國'], '2026-10-21T04:00:00Z'),
    ad(704, 'NordVPN業配', ['出國時用'], '2026-10-10T04:00:00Z'),
    ad(658, 'NordVPN業配', ['暑假比價'], '2026-05-02T04:00:00Z'),
    ad(705, 'Saily出國網路', ['eSIM'], '2026-10-14T04:00:00Z'),
    // Two ad chapters for one sponsor in one episode, and one for nobody
    ad(655, '優活業配', ['膠囊'], '2026-04-22T04:00:00Z'),
    ad(655, '優活業配', ['海藻鈣'], '2026-04-22T04:00:00Z'),
    ad(600, '開場業配', ['沒說是誰'], '2025-10-01T04:00:00Z'),
  ]);

  it('gives each sponsor its episodes, newest first, one entry per episode', () => {
    const nord = findSponsor(index, 'nordvpn')!;
    expect(nord.episodes.map((e) => e.no)).toEqual([707, 704, 658]);
    expect(findSponsor(index, 'NordVPN')).toBe(nord);
    const youhuo = findSponsor(index, 'youhuo')!;
    expect(youhuo.episodes).toHaveLength(1);
    expect(youhuo.episodes[0]!.notes.map((n) => n.text)).toEqual(['膠囊', '海藻鈣']);
    expect(youhuo.episodes[0]!.chapterTitle).toBe('優活業配');
    expect(index.unnamed.map((e) => e.no)).toEqual([600]);
  });

  it('lists sponsors by how many episodes they paid for, the same order every time', () => {
    expect(listedSponsors(index).map((s) => s.slug)).toEqual(['nordvpn', 'saily', 'youhuo']);
    // Same count, same newest episode: by slug
    const tie = buildSponsorIndex([ad(9, 'iHerb業配', []), ad(9, '如意堂業配', [])]);
    expect(listedSponsors(tie).map((s) => s.slug)).toEqual(['iherb', 'ruyitang']);
  });

  it('leaves the bullets it was given alone', () => {
    const first = ad(655, '優活業配', ['膠囊']);
    buildSponsorIndex([first, ad(655, '優活業配：海藻鈣', ['海藻鈣'])]);
    expect(first.bullets.map((b) => b.text)).toEqual(['膠囊']);
  });

  it('works out the average gap and where each episode falls in the span', () => {
    // 2026-05-02 to 2026-10-21 is 172 days over 2 gaps
    expect(averageGapDays(findSponsor(index, 'nordvpn')!)).toBe(86);
    expect(averageGapDays(findSponsor(index, 'saily')!)).toBeNull();
    const sameDay = buildSponsorIndex([ad(10, 'iHerb業配', [], '2026-01-01T04:00:00Z'), ad(11, 'iHerb業配', [], '2026-01-01T09:00:00Z')]);
    expect(averageGapDays(findSponsor(sameDay, 'iherb')!)).toBeNull();
    expect(spanPosition('2026-05-02T04:00:00Z', '2026-05-02T04:00:00Z', '2026-10-21T04:00:00Z')).toBe(0);
    expect(spanPosition('2026-10-21T04:00:00Z', '2026-05-02T04:00:00Z', '2026-10-21T04:00:00Z')).toBe(1);
  });

  it('finds a page by slug or by name, and encodes a name that is not ASCII', () => {
    const one = buildSponsorIndex([ad(702, '明星三缺一', ['本集由明星三缺一贊助'])]);
    const s = findSponsor(one, '明星三缺一')!;
    expect(sponsorHref(s)).toBe(`/sponsor/${encodeURIComponent('明星三缺一')}`);
    expect(findSponsor(one, 'nope')).toBeNull();
  });
});

describe('adChapters', () => {
  it('reads live episodes’ ad chapters and skips a broken summary', () => {
    const db = openDb(':memory:', { migrate: true });
    const ins = db.prepare(`INSERT INTO episodes (episode_no, guid, title, published_at, audio_url, status, summary_json) VALUES (?, ?, '⭐', ?, 'https://x', ?, ?)`);
    const summary = (chapters: unknown[]) => JSON.stringify({ line: '', keys: [], chapters, stocks: [], mentions: [] });
    ins.run(713, 'g713', '2026-11-11T04:00:00Z', 'done', summary([
      { t: 0, title: '開場業配', ad: true, bullets: [{ t: 5, text: '本集由火星生技贊助' }], quote: null },
      { t: 300, title: '市場', ad: false, bullets: [], quote: null },
    ]));
    ins.run(712, 'g712', '2026-11-07T04:00:00Z', 'done', '{"line":');
    ins.run(714, 'g714', '2026-11-14T04:00:00Z', 'failed', summary([{ t: 0, title: 'NordVPN業配', ad: true, bullets: [], quote: null }]));
    // Bullets that aren't a list, or a bullet without text: that chapter is left out or trimmed
    ins.run(711, 'g711', '2026-11-04T04:00:00Z', 'done', summary([{ t: 0, title: '開場業配', ad: true, bullets: 123, quote: null }]));
    ins.run(710, 'g710', '2026-11-01T04:00:00Z', 'done', summary([{ t: 0, title: '善存業配', ad: true, bullets: [{ t: 1 }, { t: 2, text: '葉黃素' }], quote: null }]));
    expect(adChapters(db).map((c) => [c.episodeNo, c.bullets.length]).sort()).toEqual([[710, 1], [713, 1]]);
    expect(adChapters(db).filter((c) => c.episodeNo === 713)).toEqual([
      { episodeNo: 713, episodeTitle: '⭐', publishedAt: '2026-11-11T04:00:00Z', audioUrl: 'https://x', title: '開場業配', t: 0, bullets: [{ t: 5, text: '本集由火星生技贊助' }] },
    ]);
  });
});
