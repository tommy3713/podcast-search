import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment } from 'react';
import { notFound } from 'next/navigation';
import { EpName } from '@/components/Badge';
import { formatDate, monthKey } from '@/lib/format';
import { shareMetadata, stockDescription, stockTitle } from '@/lib/seo';
import { stockData } from '@/lib/stock-pages';
import {
  type ChartBar,
  chartBars,
  findStock,
  monthKeyLabel,
  STOCK_LIST_MIN_EPISODES,
  STOCKS_LABEL,
  shownCode,
  stockHref,
  stockMonths,
} from '@/lib/stocks';
import { formatTimestamp } from '@/lib/summary';

type Props = { params: Promise<{ slug: string }> };

// Below this a chart says nothing the list doesn't
const CHART_MIN_EPISODES = 3;

// No loading.tsx here: a skeleton would fix the status at 200 before the slug is looked up
async function load(params: Props['params']) {
  const raw = (await params).slug;
  let segment = raw;
  try {
    segment = decodeURIComponent(raw);
  } catch {
    // A stray % in the URL: look up what was sent
  }
  const { index, liveMonths } = await stockData();
  const stock = findStock(index, segment);
  return stock && { stock, liveMonths };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const stock = (await load(params))?.stock;
  if (!stock) return { title: '找不到這一頁' };
  const title = stockTitle(stock);
  const description = stockDescription(stock);
  // /stock/tsm and /stock/2330 show the same page
  const url = stockHref(stock);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    // One episode's line about a company is too thin to be a search result
    ...(stock.episodes.length < STOCK_LIST_MIN_EPISODES ? { robots: { index: false, follow: true } } : {}),
    ...shareMetadata(title, url, description),
  };
}

// How many episodes brought it up over time: when he talked about it and how much, nothing
// about what he thought. One colour, on purpose.
function Chart({ bars }: { bars: ChartBar[] }) {
  const max = Math.max(...bars.map((b) => b.mentioned));
  const gaps = bars.some((b) => b.episodes === 0);
  // A year under its first bar, the first one only when the next is far enough not to run into it
  const years = bars.map((b, i) => (i === 0 || b.year !== bars[i - 1]!.year ? b.year : ''));
  const next = years.findIndex((y, i) => i > 0 && y !== '');
  if (next !== -1 && next < 4) years[0] = '';
  return (
    <section className="card stock-chart" aria-label="提到的集數，依時間">
      <div className="fine">
        什麼時候提到（最高的一格 {max} 集）{gaps && '・虛線是還沒收錄的時間'}
      </div>
      <div className="bars">
        {bars.map((b) => {
          if (b.target === null) {
            return <span key={b.label} className={b.episodes === 0 ? 'none' : 'zero'} title={`${b.label}：${b.episodes === 0 ? '還沒收錄' : '沒有提到'}`} />;
          }
          const text = `${b.label}：${b.mentioned} 集提到（收錄 ${b.episodes} 集）`;
          return <a key={b.label} href={`#m-${b.target}`} title={text} aria-label={text} style={{ height: `${Math.max(10, (b.mentioned / max) * 100)}%` }} />;
        })}
      </div>
      <div className="bar-years" aria-hidden="true">
        {bars.map((b, i) => (
          <span key={b.label}>{years[i]}</span>
        ))}
      </div>
    </section>
  );
}

export default async function StockPage({ params }: Props) {
  const found = await load(params);
  if (!found) notFound();
  const { stock, liveMonths } = found;
  const latest = stock.episodes[0]!;
  const earliest = stock.episodes.at(-1)!;
  const bars = stock.episodes.length >= CHART_MIN_EPISODES ? chartBars(stockMonths(stock, liveMonths)) : [];
  const perMonth = new Map<string, number>();
  for (const e of stock.episodes) perMonth.set(monthKey(e.publishedAt), (perMonth.get(monthKey(e.publishedAt)) ?? 0) + 1);

  let month = '';
  return (
    <div className="home">
      <div>
        <Link className="back" href="/stocks">
          ← 所有{STOCKS_LABEL}
        </Link>
        <div className="stock-head">
          <h1>
            {stock.name}
            {shownCode(stock) && <span className="c">{stock.code}</span>}
          </h1>
          <div className="meta">
            <span>在 {stock.episodes.length} 集提到</span>
            {/* Of the episodes on the site: backfill may still bring an earlier one */}
            {earliest.no !== latest.no && (
              <span>
                最早 <Link href={`/ep/${earliest.no}`}>EP{earliest.no}</Link>・{formatDate(earliest.publishedAt)}
              </span>
            )}
            <span>
              最近 <Link href={`/ep/${latest.no}`}>EP{latest.no}</Link>・{formatDate(latest.publishedAt)}
            </span>
          </div>
        </div>
      </div>
      {bars.length > 0 && <Chart bars={bars} />}
      <section className="card list" id="stock-eps">
        {stock.episodes.map((e) => {
          const key = monthKey(e.publishedAt);
          const header =
            key !== month ? (
              <h2 className="month" id={`m-${(month = key)}`}>
                {monthKeyLabel(key)}
                <span className="fine">　{perMonth.get(key)} 集</span>
              </h2>
            ) : null;
          return (
            <Fragment key={e.no}>
              {header}
              <div className="stock-ep">
                <div className="t">
                  <Link href={`/ep/${e.no}`}>
                    EP{e.no}
                    <EpName title={e.title} />
                  </Link>
                  <span className="fine">{formatDate(e.publishedAt)}</span>
                </div>
                <ul className="keypts">
                  {e.notes.map((n, i) => (
                    <li key={i}>
                      <Link className="ts" href={`/ep/${e.no}?t=${n.t}`} aria-label={`EP${e.no} 從 ${formatTimestamp(n.t)} 播放`}>
                        {formatTimestamp(n.t)}
                      </Link>
                      <span>{n.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Fragment>
          );
        })}
      </section>
      <p className="fine" style={{ margin: 0 }}>
        主持人在節目中的個人看法，不是投資建議。內容由 AI 自動整理，可能有遺漏或誤聽，以原節目為準。
      </p>
    </div>
  );
}
