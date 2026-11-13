import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EpName } from '@/components/Badge';
import { EpisodeFilter } from '@/components/EpisodeFilter';
import { ExcerptText, ExcerptToggle } from '@/components/Excerpt';
import { MonthChart } from '@/components/MonthChart';
import { PlayTs, StockPlayer } from '@/components/StockPlayer';
import { formatDate, monthKey } from '@/lib/format';
import { shareMetadata, stockDescription, stockTitle } from '@/lib/seo';
import type { PlayPoint } from '@/lib/seek';
import { readDb } from '@/lib/server-db';
import { excerptAt, stockData, stockPlayPoints } from '@/lib/stock-pages';
import {
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

type Props = { params: Promise<{ slug: string }> };

// Below this a chart says nothing the list doesn't
const CHART_MIN_EPISODES = 3;
// And a filter is more to read than the list it filters
const FILTER_MIN_EPISODES = 6;

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

// What he said in one episode: the chapters it came up in, the summary's note, and the
// summary's other bullets that name the company
function Said({ e, points }: { e: StockEpisode; points: Map<string, PlayPoint | null> }) {
  const point = (n: { t: number; text: string }, i: number) => (
    <li key={i}>
      {/* Plays here, in the bar at the bottom */}
      <PlayTs episodeNo={e.no} t={n.t} point={points.get(`${e.no}:${n.t}`) ?? null} />
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
  const groups: { key: string; episodes: StockEpisode[] }[] = [];
  for (const e of stock.episodes) {
    const key = monthKey(e.publishedAt);
    const m = perMonth.get(key) ?? { all: 0, deep: 0 };
    perMonth.set(key, { all: m.all + 1, deep: m.deep + (e.deep ? 1 : 0) });
    if (groups.at(-1)?.key !== key) groups.push({ key, episodes: [] });
    groups.at(-1)!.episodes.push(e);
  }
  const deep = stock.episodes.filter((e) => e.deep).length;
  // The newest episode's words are on the page from the start; the others' come on a click
  const db = await readDb();
  const latestExcerpt = excerptAt(db, latest.no, latest.notes[0]!.t);
  const points = stockPlayPoints(db, stock);
  const audio = Object.fromEntries(stock.episodes.map((e) => [e.no, e.audioUrl]));

  return (
    <StockPlayer audio={audio}>
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
        <Said e={latest} points={points} />
        {latestExcerpt && <ExcerptText episodeNo={latest.no} excerpt={latestExcerpt} />}
      </section>
      {bars.length > 0 && <MonthChart bars={bars} />}
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
          {stock.episodes.length >= FILTER_MIN_EPISODES && <EpisodeFilter />}
          {/* Works without JavaScript: the list hides the rest with :has() */}
          {deep > 0 && deep < stock.episodes.length && (
            <label className="deep-only">
              <input type="checkbox" id="deep-only" />
              只看深入談的（{deep} 集）
            </label>
          )}
        </div>
        {groups.map((g) => {
          const count = perMonth.get(g.key)!;
          return (
            // A group per month, so the filters can hide a month left without episodes
            <div key={g.key} className="month-group">
              <h2 className="month" id={`m-${g.key}`} data-deep={count.deep}>
                {monthKeyLabel(g.key)}
                <span className="fine n-all">　{count.all} 集</span>
                <span className="fine n-deep">　{count.deep} 集</span>
              </h2>
              {g.episodes.map((e) => (
                <div key={e.no} className={e.deep ? 'stock-ep deep' : 'stock-ep'}>
                  <EpisodeLine e={e} />
                  <Said e={e} points={points} />
                  <ExcerptToggle episodeNo={e.no} t={e.notes[0]!.t} />
                </div>
              ))}
            </div>
          );
        })}
      </section>
      <p className="fine" style={{ margin: 0 }}>
        主持人在節目中的個人看法，不是投資建議。「深入談」只表示那一集談得比較多。內容由 AI 自動整理，可能有遺漏或誤聽，以原節目為準。
      </p>
    </div>
    </StockPlayer>
  );
}
