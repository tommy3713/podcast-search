import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE_NAME, shareMetadata } from '@/lib/seo';
import { listedSponsors, sponsorHref } from '@/lib/sponsors';
import { stockData } from '@/lib/stock-pages';
import { listedStocks, STOCK_LIST_MIN_EPISODES, STOCKS_LABEL } from '@/lib/stocks';
import { listedTopics, TOPIC_CATEGORIES, TOPIC_INDEX_MIN_EPISODES, topicCategoryHref, topicHref } from '@/lib/topics';

const TITLE = `主題・${SITE_NAME}`;
const DESCRIPTION = '《股癌》跨集數的主題整理：提過的個股、業配，以及主委的運動、電玩、旅遊、書影音、美食和科技產品，每一個在哪幾集、第幾分鐘。非官方粉絲整理。';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/topics' },
  ...shareMetadata(TITLE, '/topics', DESCRIPTION),
};

type Card = { href: string; label: string; blurb: string; count: string; samples: { href: string; name: string }[] };

const SAMPLES = 5;

export default async function TopicsPage() {
  const { index, sponsors, topics } = await stockData();
  const stockCount = listedStocks(index).reduce((n, g) => n + g.stocks.length, 0);
  const sponsorList = listedSponsors(sponsors);
  const cards: Card[] = [
    // No samples for stocks: picking a few would read as picks
    { href: '/stocks', label: STOCKS_LABEL, blurb: '節目裡提過的公司和 ETF，每一集說了什麼', count: `${stockCount} 個`, samples: [] },
    {
      href: '/sponsors',
      label: '業配',
      blurb: '哪些品牌贊助過、幾次、每次主打什麼',
      count: `${sponsorList.length} 個品牌`,
      samples: sponsorList.slice(0, SAMPLES).map((s) => ({ href: sponsorHref(s), name: s.name })),
    },
    ...TOPIC_CATEGORIES.map((c) => {
      const items = listedTopics(topics, c.slug);
      const repeated = items.filter((i) => i.episodes.length >= TOPIC_INDEX_MIN_EPISODES).length;
      return {
        href: topicCategoryHref(c),
        label: c.label,
        blurb: c.blurb,
        count: `${items.length} 項`,
        samples: items.slice(0, Math.min(SAMPLES, repeated)).map((i) => ({ href: topicHref(i), name: i.name })),
      };
    }),
  ];

  return (
    <div className="home">
      <div className="stock-head">
        <h1>主題</h1>
        <p className="muted" style={{ margin: 0 }}>
          跨集數整理：每一個在哪幾集、第幾分鐘提到。{STOCKS_LABEL}只列 {STOCK_LIST_MIN_EPISODES} 集以上的。
        </p>
      </div>
      <div className="topic-cards">
        {cards.map((c) => (
          <section key={c.href} className="card topic-card">
            <h2>
              <Link href={c.href} prefetch={false}>
                {c.label}
              </Link>
              <span className="fine">{c.count}</span>
            </h2>
            <p className="muted">{c.blurb}</p>
            {c.samples.length > 0 && (
              <div className="chips">
                {c.samples.map((s) => (
                  <Link key={s.href} className="chip" href={s.href} prefetch={false}>
                    {s.name}
                  </Link>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
      <p className="fine" style={{ margin: 0 }}>
        內容由 AI 從每一集的摘要整理，可能有遺漏或誤聽，以原節目為準。
      </p>
    </div>
  );
}
