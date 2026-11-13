import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EpisodeTimeline } from '@/components/EpisodeTimeline';
import { MonthChart } from '@/components/MonthChart';
import { StockPlayer } from '@/components/StockPlayer';
import { formatDate } from '@/lib/format';
import { shareMetadata } from '@/lib/seo';
import { readDb } from '@/lib/server-db';
import { stockData, stockPlayPoints } from '@/lib/stock-pages';
import { chartBars, stockMonths } from '@/lib/stocks';
import { findTopic, TOPIC_INDEX_MIN_EPISODES, type TopicItem, topicCategoryHref, topicHref } from '@/lib/topics';

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
  return item && { item, liveMonths };
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
  const { item, liveMonths } = found;
  const [latest, first] = [item.episodes[0]!, item.episodes.at(-1)!];
  const bars = item.episodes.length >= CHART_MIN_EPISODES ? chartBars(stockMonths(item, liveMonths)) : [];
  const points = stockPlayPoints(await readDb(), item);
  const audio = Object.fromEntries(item.episodes.map((e) => [e.no, e.audioUrl]));

  return (
    <StockPlayer audio={audio}>
      <div className="home">
        <div>
          <Link className="back" href={topicCategoryHref(item.category)}>
            ← 所有{item.category.label}
          </Link>
          <div className="stock-head">
            <h1>{item.name}</h1>
            <div className="meta">
              <span>在 {item.episodes.length} 集提到</span>
              {first.no !== latest.no && (
                <span>
                  最早 <Link href={`/ep/${first.no}`}>EP{first.no}</Link>・{formatDate(first.publishedAt)}
                </span>
              )}
              <span>
                最近 <Link href={`/ep/${latest.no}`}>EP{latest.no}</Link>・{formatDate(latest.publishedAt)}
              </span>
            </div>
          </div>
        </div>
        {bars.length > 0 && <MonthChart bars={bars} />}
        <EpisodeTimeline heading="每一集說了什麼" episodes={item.episodes} points={points} />
        <p className="fine" style={{ margin: 0 }}>
          內容由 AI 從每一集的摘要整理，引述是摘要記下的原話，可能有誤聽。以原節目為準。
        </p>
      </div>
    </StockPlayer>
  );
}
