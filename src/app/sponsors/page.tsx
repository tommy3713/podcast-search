import type { Metadata } from 'next';
import Link from 'next/link';
import { DotStrip } from '@/components/Sparkline';
import { Marquee, StatRow, TopicCard } from '@/components/TopicCard';
import { SpotlightGrid } from '@/components/TopicsMotion';
import { SITE_NAME, shareMetadata } from '@/lib/seo';
import { averageGapDays, listedSponsors, SPONSOR_INDEX_MIN_EPISODES, spanPosition, sponsorHref } from '@/lib/sponsors';
import { stockData } from '@/lib/stock-pages';
import { bigCards, recentItems } from '@/lib/topics-overview';

const TITLE = `股癌業配一覽・${SITE_NAME}`;
const DESCRIPTION = '《股癌》每一集的業配：哪些品牌贊助過、幾次、第一次和最近一次在哪一集，每次主打什麼。非官方粉絲整理。';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/sponsors' },
  ...shareMetadata(TITLE, '/sponsors', DESCRIPTION),
};

export default async function SponsorsPage() {
  const { sponsors: index, topics, newest } = await stockData();
  const sponsors = listedSponsors(index);
  const all = sponsors.flatMap((s) => s.episodes);
  if (all.length === 0) {
    return (
      <div className="home">
        <div className="card placeholder">
          <h2 className="display" style={{ margin: 0 }}>還沒有業配資料</h2>
        </div>
      </div>
    );
  }
  // Every sponsor's dots span the same stretch: the first ad on the site to the newest
  const dates = all.map((e) => e.publishedAt).sort();
  const [from, to] = [dates[0]!, dates.at(-1)!];
  const unnamed = index.unnamed;
  const episodes = new Set([...all, ...unnamed].map((e) => e.no)).size;
  const repeated = sponsors.filter((s) => s.episodes.length >= SPONSOR_INDEX_MIN_EPISODES);
  const once = sponsors.filter((s) => s.episodes.length < SPONSOR_INDEX_MIN_EPISODES);
  const recent = recentItems(topics, index, newest, 'sponsors').map(({ href, label }) => ({ href, label }));
  const big = bigCards(repeated.length);

  return (
    <div className="home topics-page">
      <Link className="back" href="/topics" prefetch={false}>
        ← 所有主題
      </Link>
      <div className="stock-head">
        <h1>業配</h1>
        <p className="muted" style={{ margin: 0 }}>
          哪些品牌贊助過、幾次、每次主打什麼，照贊助的集數排。品牌名稱由 AI 從摘要整理，可能有誤聽。
        </p>
      </div>
      <StatRow
        stats={[
          { label: '品牌', value: sponsors.length, unit: '個' },
          { label: `贊助 ${SPONSOR_INDEX_MIN_EPISODES} 集以上`, value: repeated.length, unit: '個' },
          { label: '有業配的集數', value: episodes, unit: '集' },
        ]}
      />
      <Marquee items={recent} label="最近的業配" />
      {repeated.length > 0 && (
      <SpotlightGrid className="bento">
        {repeated.map((s, i) => {
          const gap = averageGapDays(s);
          return (
            <TopicCard
              key={s.slug}
              i={i}
              href={sponsorHref(s)}
              label={s.name}
              count={s.episodes.length}
              unit="集"
              big={i < big}
              // A dot per ad, placed by date over the same stretch for every sponsor, big or small
              preview={<DotStrip positions={s.episodes.map((e) => spanPosition(e.publishedAt, from, to))} label={`第一次 EP${s.episodes.at(-1)!.no}，最近 EP${s.episodes[0]!.no}`} />}
              facts={[`最近 EP${s.episodes[0]!.no}`, `第一次 EP${s.episodes.at(-1)!.no}`, ...(gap !== null ? [`平均每 ${gap} 天`] : [])]}
            />
          );
        })}
      </SpotlightGrid>
      )}
      {once.length > 0 && (
        <section className="card topic-once">
          <h2 className="month">
            只出現一次
            <span className="fine">　{once.length} 個</span>
          </h2>
          <div className="chips">
            {once.map((s) => (
              <Link key={s.slug} className="chip" href={sponsorHref(s)} prefetch={false} title={`EP${s.episodes[0]!.no}`}>
                {s.name}
              </Link>
            ))}
          </div>
        </section>
      )}
      {unnamed.length > 0 && (
        <p className="fine" style={{ margin: 0 }}>
          另有 {unnamed.length} 段業配沒寫出品牌：
          {unnamed.map((e, i) => (
            <span key={`${e.no}-${i}`}>
              {i > 0 && '、'}
              <Link href={`/ep/${e.no}?t=${e.notes[0]!.t}`}>EP{e.no}</Link>
            </span>
          ))}
        </p>
      )}
      <p className="fine" style={{ margin: 0 }}>
        只算節目摘要裡標成業配的段落。內容由 AI 自動整理，可能有遺漏或誤聽，以原節目為準。
      </p>
    </div>
  );
}
