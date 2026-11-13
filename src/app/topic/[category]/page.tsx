import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SITE_NAME, shareMetadata } from '@/lib/seo';
import { stockData } from '@/lib/stock-pages';
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
  const items = listedTopics((await stockData()).topics, c.slug);
  const repeated = items.filter((i) => i.episodes.length >= TOPIC_INDEX_MIN_EPISODES);
  const once = items.filter((i) => i.episodes.length < TOPIC_INDEX_MIN_EPISODES);

  return (
    <div className="home">
      <Link className="back" href="/topics" prefetch={false}>
        ← 所有主題
      </Link>
      <div className="stock-head">
        <h1>{c.label}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {c.blurb}，共 {items.length} 項，照提到的集數排。
        </p>
      </div>
      {repeated.length > 0 && (
        <section className="card list">
          <h2 className="month">
            提過 {TOPIC_INDEX_MIN_EPISODES} 集以上
            <span className="fine">　{repeated.length} 項</span>
          </h2>
          <div className="stock-grid">
            {repeated.map((i) => (
              <Link key={i.slug} href={topicHref(i)} prefetch={false}>
                <span className="n">{i.name}</span>
                <span className="fine">{i.episodes.length} 集</span>
              </Link>
            ))}
          </div>
        </section>
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
        內容由 AI 從每一集的摘要整理，名稱可能有誤聽，同一件事也可能寫成不同名字。以原節目為準。
      </p>
    </div>
  );
}
