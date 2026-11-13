import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExcerptText } from '@/components/Excerpt';
import { MonthChart } from '@/components/MonthChart';
import { QuoteWall, Said } from '@/components/QuoteWall';
import { PlayTs, StockPlayer } from '@/components/StockPlayer';
import { StatRow } from '@/components/TopicCard';
import { formatDate } from '@/lib/format';
import { shareMetadata } from '@/lib/seo';
import { readDb } from '@/lib/server-db';
import { excerptAt, stockData, stockPlayPoints } from '@/lib/stock-pages';
import { chartBars, stockMonths } from '@/lib/stocks';
import { monthsBetween, spanFrom } from '@/lib/topics-overview';
import { coTopics, findTopic, TOPIC_INDEX_MIN_EPISODES, type TopicItem, topicCategoryHref, topicHref, topicQuestion } from '@/lib/topics';

type Props = { params: Promise<{ category: string; item: string }> };

const CHART_MIN_EPISODES = 3;

// No loading.tsx: a skeleton would fix the status at 200 before the item is looked up
async function load(params: Props['params']) {
  const p = await params;
  let segment = p.item;
  try {
    segment = decodeURIComponent(segment);
  } catch {
    // A stray % in the URL: look up what was sent
  }
  const { topics, liveMonths } = await stockData();
  const item = findTopic(topics, p.category, segment);
  return item && { item, topics, liveMonths };
}

function title(i: TopicItem): string {
  return `股癌 ${i.name}｜${i.category.label}・在 ${i.episodes.length} 集提到`;
}

function description(i: TopicItem): string {
  const eps = i.episodes.slice(0, 3).map((e) => `EP${e.no}`).join('、');
  const n = i.episodes.length;
  return `《股癌》主委在 ${eps}${n > 3 ? ` 等 ${n} 集` : ''}提到${i.name}：每一集說了什麼、在第幾分鐘。非官方粉絲整理。`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const item = (await load(params))?.item;
  if (!item) return { title: '找不到這一頁' };
  const url = topicHref(item);
  return {
    title: { absolute: title(item) },
    description: description(item),
    alternates: { canonical: url },
    ...(item.episodes.length < TOPIC_INDEX_MIN_EPISODES ? { robots: { index: false, follow: true } } : {}),
    ...shareMetadata(title(item), url, description(item)),
  };
}

export default async function TopicItemPage({ params }: Props) {
  const found = await load(params);
  if (!found) notFound();
  const { item, topics, liveMonths } = found;
  const [latest, first] = [item.episodes[0]!, item.episodes.at(-1)!];
  // Its own span: from the month it first came up to the site's newest
  const bars = item.episodes.length >= CHART_MIN_EPISODES ? chartBars(stockMonths(item, spanFrom(liveMonths, first.publishedAt))) : [];
  const db = await readDb();
  const points = stockPlayPoints(db, item);
  const audio = Object.fromEntries(item.episodes.map((e) => [e.no, e.audioUrl]));
  const lead = latest.notes[0]!;
  // The newest episode's words are on the page from the start; the others' come on a click
  const excerpt = excerptAt(db, latest.no, lead.t);
  const related = coTopics(topics, item);
  const question = topicQuestion(item);

  return (
    <StockPlayer audio={audio}>
      <div className="home topics-page">
        <Link className="back" href={topicCategoryHref(item.category)} prefetch={false}>
          ← 所有{item.category.label}
        </Link>
        <div className="stock-head">
          <h1>{item.name}</h1>
        </div>
        <StatRow
          stats={[
            { label: '提到', value: item.episodes.length, unit: '集' },
            // Between the first and the newest mention, both ends named: not "since", which an item
            // that stopped coming up would read wrongly
            ...(first.no !== latest.no
              ? [{ label: `${formatDate(first.publishedAt).slice(0, 7)}–${formatDate(latest.publishedAt).slice(0, 7)}`, value: monthsBetween(first.publishedAt, latest.publishedAt), unit: '個月' }]
              : []),
            { label: `最近一集・${formatDate(latest.publishedAt).slice(0, 10)}`, value: latest.no, prefix: 'EP', href: `/ep/${latest.no}` },
          ]}
        />
        <section className="card stock-latest quote-hero">
          <div className="eyebrow">
            最近一次・EP{latest.no}・{formatDate(latest.publishedAt)}
          </div>
          <blockquote className={lead.quoted ? undefined : 'bare'}>
            <Said note={lead} />
          </blockquote>
          {latest.line && <p className="qline">{latest.line}</p>}
          {excerpt ? (
            <ExcerptText episodeNo={latest.no} excerpt={excerpt} />
          ) : (
            <div>
              <PlayTs episodeNo={latest.no} t={lead.t} point={points.get(`${latest.no}:${lead.t}`) ?? null} />
            </div>
          )}
        </section>
        {bars.length > 0 && <MonthChart bars={bars} />}
        <section className="card stock-next">
          {related.length > 0 && (
            <div>
              <h3>同一集也提到</h3>
              <div className="chips">
                {related.map((r) => (
                  <Link key={topicHref(r)} className="chip" href={topicHref(r)} prefetch={false}>
                    {r.category.slug !== item.category.slug && <span className="fine">{r.category.label}</span>} {r.name}
                  </Link>
                ))}
              </div>
            </div>
          )}
          {/* nofollow: /ask is noindex, and a crawler would ask for one per item */}
          <Link className="btn" href={`/ask?q=${encodeURIComponent(question)}`} prefetch={false} rel="nofollow">
            問 AI：{question}
          </Link>
        </section>
        <QuoteWall episodes={item.episodes} points={points} />
        <p className="fine" style={{ margin: 0 }}>
          內容由 AI 從每一集的摘要整理，引述是摘要記下的原話，可能有誤聽。以原節目為準。
        </p>
      </div>
    </StockPlayer>
  );
}
