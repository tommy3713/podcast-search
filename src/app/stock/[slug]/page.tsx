import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment } from 'react';
import { notFound } from 'next/navigation';
import { EpName } from '@/components/Badge';
import { ExcerptText, ExcerptToggle } from '@/components/Excerpt';
import { formatDate, monthKey } from '@/lib/format';
import { shareMetadata, stockDescription, stockTitle } from '@/lib/seo';
import { readDb } from '@/lib/server-db';
import { excerptAt, stockData } from '@/lib/stock-pages';
import {
  type ChartBar,
  chartBars,
  coMentioned,
  findStock,
  monthKeyLabel,
  STOCK_LIST_MIN_EPISODES,
  STOCKS_LABEL,
  type StockEpisode,
  shownCode,
  stockHref,
  stockMonths,
  stockQuestion,
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
  return stock && { stock, liveMonths, index };
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

// What he said in one episode: the chapters it came up in, the summary's note, and the
// summary's other bullets that name the company
function Said({ e }: { e: StockEpisode }) {
  const point = (n: { t: number; text: string }, i: number) => (
    <li key={i}>
      <Link className="ts" href={`/ep/${e.no}?t=${n.t}`} aria-label={`EP${e.no} 從 ${formatTimestamp(n.t)} 播放`}>
        {formatTimestamp(n.t)}
      </Link>
      <span>{n.text}</span>
    </li>
  );
  return (
    <>
      {e.chapters.length > 0 && (
        <div className="ch">
          <span className="fine">章節</span>
          {e.chapters.join('・')}
        </div>
      )}
      <ul className="keypts">{e.notes.map(point)}</ul>
      {e.points.length > 0 && <ul className="keypts more">{e.points.map(point)}</ul>}
    </>
  );
}

function EpisodeLine({ e }: { e: StockEpisode }) {
  return (
    <div className="t">
      <Link href={`/ep/${e.no}`}>
        EP{e.no}
        <EpName title={e.title} />
      </Link>
      <span className="fine">{formatDate(e.publishedAt)}</span>
      {e.deep && <span className="pill info">深入談</span>}
    </div>
  );
}

export default async function StockPage({ params }: Props) {
  const found = await load(params);
  if (!found) notFound();
  const { stock, liveMonths, index } = found;
  const others = coMentioned(index, stock);
  const question = stockQuestion(stock);
  const latest = stock.episodes[0]!;
  const earliest = stock.episodes.at(-1)!;
  const bars = stock.episodes.length >= CHART_MIN_EPISODES ? chartBars(stockMonths(stock, liveMonths)) : [];
  // Per month: episodes, and how many of them dwell on it
  const perMonth = new Map<string, { all: number; deep: number }>();
  for (const e of stock.episodes) {
    const key = monthKey(e.publishedAt);
    const m = perMonth.get(key) ?? { all: 0, deep: 0 };
    perMonth.set(key, { all: m.all + 1, deep: m.deep + (e.deep ? 1 : 0) });
  }
  const deep = stock.episodes.filter((e) => e.deep).length;
  // The newest episode's words are on the page from the start; the others' come on a click
  const latestExcerpt = excerptAt(await readDb(), latest.no, latest.notes[0]!.t);

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
      <section className="card stock-latest">
        <div className="eyebrow">最近一次提到</div>
        <EpisodeLine e={latest} />
        <Said e={latest} />
        {latestExcerpt && <ExcerptText episodeNo={latest.no} excerpt={latestExcerpt} />}
      </section>
      {bars.length > 0 && <Chart bars={bars} />}
      <section className="card stock-next">
        {others.length > 0 && (
          <div>
            <h3>同一集也提到</h3>
            <div className="chips">
              {others.map((o) => (
                <Link key={o.slug} className="chip" href={stockHref(o)} prefetch={false}>
                  {o.name}
                </Link>
              ))}
            </div>
          </div>
        )}
        {/* nofollow: /ask is noindex, and a crawler would ask for one per stock */}
        <Link className="btn" href={`/ask?q=${encodeURIComponent(question)}`} prefetch={false} rel="nofollow">
          問 AI：{question}
        </Link>
      </section>
      <section className="card list" id="stock-eps">
        <div className="list-head">
          <h3>
            每一集說了什麼
            <span className="fine">共 {stock.episodes.length} 集</span>
          </h3>
          {/* Works without JavaScript: the list hides the rest with :has() */}
          {deep > 0 && deep < stock.episodes.length && (
            <label className="deep-only">
              <input type="checkbox" id="deep-only" />
              只看深入談的（{deep} 集）
            </label>
          )}
        </div>
        {stock.episodes.map((e) => {
          const key = monthKey(e.publishedAt);
          const count = perMonth.get(key)!;
          const header =
            key !== month ? (
              <h2 className="month" id={`m-${(month = key)}`} data-deep={count.deep}>
                {monthKeyLabel(key)}
                <span className="fine n-all">　{count.all} 集</span>
                <span className="fine n-deep">　{count.deep} 集</span>
              </h2>
            ) : null;
          return (
            <Fragment key={e.no}>
              {header}
              <div className={e.deep ? 'stock-ep deep' : 'stock-ep'}>
                <EpisodeLine e={e} />
                <Said e={e} />
                <ExcerptToggle episodeNo={e.no} t={e.notes[0]!.t} />
              </div>
            </Fragment>
          );
        })}
      </section>
      <p className="fine" style={{ margin: 0 }}>
        主持人在節目中的個人看法，不是投資建議。「深入談」只表示那一集談得比較多。內容由 AI 自動整理，可能有遺漏或誤聽，以原節目為準。
      </p>
    </div>
  );
}
