import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Sparkline } from '@/components/Sparkline';
import { Marquee, StatRow, TopicCard } from '@/components/TopicCard';
import { SpotlightGrid } from '@/components/TopicsMotion';
import { SITE_NAME, shareMetadata } from '@/lib/seo';
import { stockData } from '@/lib/stock-pages';
import { bigCards, monthlySeries, recentItems } from '@/lib/topics-overview';
import { listedTopics, TOPIC_INDEX_MIN_EPISODES, topicCategory, topicCategoryHref, topicHref } from '@/lib/topics';

type Props = { params: Promise<{ category: string }> };

function meta(label: string, blurb: string) {
  return { title: `股癌的${label}・${SITE_NAME}`, description: `《股癌》${blurb}：每一個在哪幾集、第幾分鐘提到，主委說了什麼。非官方粉絲整理。` };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = topicCategory((await params).category);
  if (!c) return { title: '找不到這一頁' };
  const { title, description } = meta(c.label, c.blurb);
  const url = topicCategoryHref(c);
  return { title: { absolute: title }, description, alternates: { canonical: url }, ...shareMetadata(title, url, description) };
}

export default async function TopicCategoryPage({ params }: Props) {
  const c = topicCategory((await params).category);
  if (!c) notFound();
  const { topics, sponsors, liveMonths, newest } = await stockData();
  const items = listedTopics(topics, c.slug);
  const repeated = items.filter((i) => i.episodes.length >= TOPIC_INDEX_MIN_EPISODES);
  const once = items.filter((i) => i.episodes.length < TOPIC_INDEX_MIN_EPISODES);
  const episodes = new Set(items.flatMap((i) => i.episodes.map((e) => e.no))).size;
  const big = bigCards(repeated.length);
  // This category's things in the newest two episodes; the strip doesn't repeat the category
  const recent = recentItems(topics, sponsors, newest, { category: c.slug }).map(({ href, label }) => ({ href, label }));

  return (
    <div className="home topics-page">
      <Link className="back" href="/topics" prefetch={false}>
        ← 所有主題
      </Link>
      <div className="stock-head">
        <h1>{c.label}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {c.blurb}，照提到的集數排。
        </p>
      </div>
      <StatRow
        stats={[
          { label: '項目', value: items.length, unit: '項' },
          { label: `提過 ${TOPIC_INDEX_MIN_EPISODES} 集以上`, value: repeated.length, unit: '項' },
          { label: '提到的集數', value: episodes, unit: '集' },
        ]}
      />
      <Marquee items={recent} label="最近提到" />
      {repeated.length > 0 && (
        <SpotlightGrid className="bento">
          {repeated.map((item, i) => (
            <TopicCard
              key={item.slug}
              i={i}
              href={topicHref(item)}
              label={item.name}
              count={item.episodes.length}
              unit="集"
              big={i < big}
              preview={<Sparkline bars series={monthlySeries(item.episodes.map((e) => e.publishedAt), liveMonths)} label={`每個月提到${item.name}的集數`} />}
              facts={[`最近 EP${item.episodes[0]!.no}`, `最早 EP${item.episodes.at(-1)!.no}`]}
            />
          ))}
        </SpotlightGrid>
      )}
      {once.length > 0 && (
        <section className="card topic-once">
          <h2 className="month">
            提過一次
            <span className="fine">　{once.length} 項</span>
          </h2>
          {/* Straight to the moment: a page for one mention says no more than the episode */}
          <div className="chips">
            {once.map((i) => {
              const e = i.episodes[0]!;
              return (
                <Link key={i.slug} className="chip" href={`/ep/${e.no}?t=${e.notes[0]!.t}`} prefetch={false} title={`EP${e.no}：${e.notes[0]!.text}`}>
                  {i.name}
                </Link>
              );
            })}
          </div>
        </section>
      )}
      <p className="fine" style={{ margin: 0 }}>
        {c.source === 'transcript'
          ? '從每一集的逐字稿找出說到這些節日的集數，業配不算。逐字稿由 AI 轉錄，可能有誤聽或遺漏。以原節目為準。'
          : '內容由 AI 從每一集的摘要整理，名稱可能有誤聽，同一件事也可能寫成不同名字。以原節目為準。'}
      </p>
    </div>
  );
}
