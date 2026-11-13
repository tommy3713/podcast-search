import type { Metadata } from 'next';
import Link from 'next/link';
import { Sparkline, TopBars } from '@/components/Sparkline';
import { CountUp, SpotlightGrid } from '@/components/TopicsMotion';
import { sitemapEpisodes } from '@/lib/episodes';
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

type Card = {
  key: string;
  href: string;
  label: string;
  blurb: string;
  count: number;
  unit: string;
  big: boolean;
  preview: React.ReactNode;
  samples: { href: string; name: string }[];
  // Plain facts under the blurb
  facts?: string[];
};

// The two big cards: the one the site started with, and the most talked-about part of his life
const BIG = new Set(['stocks', 'sports']);
const MARQUEE_MIN = 8;

export default async function TopicsPage() {
  const { index, sponsors, topics, liveMonths } = await stockData();
  const markets = listedStocks(index);
  const stocks = markets.flatMap((g) => g.stocks);
  const sponsorList = listedSponsors(sponsors);

  const cards: Card[] = [
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
      samples: [],
      facts: markets.map((g) => `${MARKET_LABELS[g.market]} ${g.stocks.length}`),
    },
    {
      key: 'sponsors',
      href: '/sponsors',
      label: '業配',
      blurb: '哪些品牌贊助過、幾次、每次主打什麼',
      count: sponsorList.length,
      unit: '個品牌',
      big: false,
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
  cards.sort((a, b) => Number(b.big) - Number(a.big));

  // The newest two live episodes, whether or not they brought anything up here
  const newest = (await sitemapEpisodes()).slice(0, 2).map((e) => e.no);
  const recent = recentItems(topics, sponsors, newest);
  // Too few to fill the strip twice over: they just sit there
  const still = recent.length < MARQUEE_MIN;

  return (
    <div className="home topics-page">
      <div className="stock-head">
        <h1>主題</h1>
        <p className="muted" style={{ margin: 0 }}>
          跨集數整理：每一個在哪幾集、第幾分鐘提到。
        </p>
      </div>

      {recent.length > 0 && (
        // After the library's 無限捲動卡片牆: what the newest episodes brought up, sliding by
        <section className={`marquee${still ? ' still' : ''}`} aria-label="最近幾集提到">
          <span className="marquee-label">最近提到</span>
          <div className="marquee-view">
            <div className="marquee-track" style={{ ['--n' as string]: recent.length }}>
              {(still ? [0] : [0, 1]).map((copy) => (
                // The second copy only closes the loop
                <div key={copy} className="marquee-set" aria-hidden={copy === 1 || undefined}>
                  {recent.map((r) => (
                    <Link key={r.href} href={r.href} prefetch={false} tabIndex={copy === 1 ? -1 : undefined} className="chip">
                      <span className="fine">{r.kind}</span>
                      {r.label}
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <SpotlightGrid className="bento">
        {cards.map((c, i) => (
          <section key={c.key} className={`card tcard${c.big ? ' big' : ''}`} style={{ ['--i' as string]: i }}>
            <div className="tpreview">{c.preview}</div>
            <div className="tbody">
              <h2>
                <Link href={c.href} prefetch={false}>
                  {c.label}
                </Link>
                <span className="tcount">
                  <CountUp value={c.count} />
                  <span className="fine">{c.unit}</span>
                </span>
              </h2>
              <p className="muted">{c.blurb}</p>
              {c.facts && (
                <ul className="tfacts">
                  {c.facts.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
              {c.samples.length > 0 && (
                <div className="chips">
                  {c.samples.map((s) => (
                    <Link key={s.href} className="chip" href={s.href} prefetch={false}>
                      {s.name}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </section>
        ))}
      </SpotlightGrid>

      <p className="fine" style={{ margin: 0 }}>
        內容由 AI 從每一集的摘要整理，可能有遺漏或誤聽，以原節目為準。
      </p>
    </div>
  );
}
