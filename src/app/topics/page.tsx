import type { Metadata } from 'next';
import { Sparkline, TopBars } from '@/components/Sparkline';
import { Marquee, TopicCard, type TopicCardProps } from '@/components/TopicCard';
import { SpotlightGrid } from '@/components/TopicsMotion';
import { SITE_NAME, shareMetadata } from '@/lib/seo';
import { listedSponsors, sponsorHref } from '@/lib/sponsors';
import { stockData } from '@/lib/stock-pages';
import { listedStocks, MARKET_LABELS, STOCK_LIST_MIN_EPISODES, STOCKS_LABEL } from '@/lib/stocks';
import { monthlySeries, recentItems } from '@/lib/topics-overview';
import { listedTopics, TOPIC_CATEGORIES, TOPIC_INDEX_MIN_EPISODES, topicCategoryHref, topicHref } from '@/lib/topics';

const TITLE = `主題・${SITE_NAME}`;
const DESCRIPTION =
  '《股癌》跨集數的主題整理：提過的個股、業配，以及主委的運動、電玩、旅遊、書影音、美食、科技產品和家庭，每一個在哪幾集、第幾分鐘。非官方粉絲整理。';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/topics' },
  ...shareMetadata(TITLE, '/topics', DESCRIPTION),
};

// The two big cards: the one the site started with, and the most talked-about part of his life
const BIG = new Set(['stocks', 'sports']);

export default async function TopicsPage() {
  const { index, sponsors, topics, liveMonths, newest } = await stockData();
  const markets = listedStocks(index);
  const stocks = markets.flatMap((g) => g.stocks);
  const sponsorList = listedSponsors(sponsors);

  const cards: (Omit<TopicCardProps, 'i'> & { key: string })[] = [
    {
      key: 'stocks',
      href: '/stocks',
      label: STOCKS_LABEL,
      blurb: `節目裡在 ${STOCK_LIST_MIN_EPISODES} 集以上提過的公司和 ETF，每一集說了什麼`,
      count: stocks.length,
      unit: '個',
      big: true,
      // Every stock mention, month by month: how much of the show is about markets
      preview: <Sparkline bars series={monthlySeries([...index.byKey.values()].flatMap((s) => s.episodes.map((e) => e.publishedAt)), liveMonths)} label="每個月提到個股的次數" />,
      // None named: picking a few would read as picks. How many per market instead.
      facts: markets.map((g) => `${MARKET_LABELS[g.market]} ${g.stocks.length}`),
    },
    {
      key: 'sponsors',
      href: '/sponsors',
      label: '業配',
      blurb: '哪些品牌贊助過、幾次、每次主打什麼',
      count: sponsorList.length,
      unit: '個品牌',
      preview: <TopBars rows={sponsorList.slice(0, 3).map((s) => ({ name: s.name, value: s.episodes.length }))} label="業配集數最多的品牌" />,
      samples: sponsorList.slice(3, 6).map((s) => ({ href: sponsorHref(s), name: s.name })),
    },
    ...TOPIC_CATEGORIES.map((c) => {
      const items = listedTopics(topics, c.slug);
      const big = BIG.has(c.slug);
      const repeated = items.filter((i) => i.episodes.length >= TOPIC_INDEX_MIN_EPISODES);
      return {
        key: c.slug,
        href: topicCategoryHref(c),
        label: c.label,
        blurb: c.blurb,
        count: items.length,
        unit: '項',
        big,
        preview: <Sparkline bars={big} series={monthlySeries(items.flatMap((i) => i.episodes.map((e) => e.publishedAt)), liveMonths)} label={`每個月提到${c.label}的次數`} />,
        samples: repeated.slice(0, big ? 8 : 3).map((i) => ({ href: topicHref(i), name: i.name })),
      };
    }),
  ];
  // Big cards first, then the rest in their order
  cards.sort((a, b) => Number(b.big ?? false) - Number(a.big ?? false));

  return (
    <div className="home topics-page">
      <div className="stock-head">
        <h1>主題</h1>
        <p className="muted" style={{ margin: 0 }}>
          跨集數整理：每一個在哪幾集、第幾分鐘提到。
        </p>
      </div>
      <Marquee items={recentItems(topics, sponsors, newest)} />
      <SpotlightGrid className="bento">
        {cards.map(({ key, ...c }, i) => (
          <TopicCard key={key} {...c} i={i} />
        ))}
      </SpotlightGrid>
      <p className="fine" style={{ margin: 0 }}>
        內容由 AI 從每一集的摘要整理，可能有遺漏或誤聽，以原節目為準。
      </p>
    </div>
  );
}
