import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EpName } from '@/components/Badge';
import { formatDate } from '@/lib/format';
import { shareMetadata, stockDescription, stockTitle } from '@/lib/seo';
import { stockIndex } from '@/lib/stock-pages';
import { findStock, STOCK_LIST_MIN_EPISODES, STOCKS_LABEL, shownCode, stockHref } from '@/lib/stocks';
import { formatTimestamp } from '@/lib/summary';

type Props = { params: Promise<{ slug: string }> };

// No loading.tsx here: a skeleton would fix the status at 200 before the slug is looked up
async function load(params: Props['params']) {
  const raw = (await params).slug;
  let segment = raw;
  try {
    segment = decodeURIComponent(raw);
  } catch {
    // A stray % in the URL: look up what was sent
  }
  return findStock(await stockIndex(), segment);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const stock = await load(params);
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

export default async function StockPage({ params }: Props) {
  const stock = await load(params);
  if (!stock) notFound();
  const latest = stock.episodes[0]!;

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
            <span>最近一次 {formatDate(latest.publishedAt)}</span>
          </div>
        </div>
      </div>
      <section className="card list" id="stock-eps">
        {stock.episodes.map((e) => (
          <div key={e.no} className="stock-ep">
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
        ))}
      </section>
      <p className="fine" style={{ margin: 0 }}>
        主持人在節目中的個人看法，不是投資建議。內容由 AI 自動整理，可能有遺漏或誤聽，以原節目為準。
      </p>
    </div>
  );
}
