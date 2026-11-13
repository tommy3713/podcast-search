import type { Metadata } from 'next';
import Link from 'next/link';
import { formatDate } from '@/lib/format';
import { SITE_NAME, shareMetadata } from '@/lib/seo';
import { listedSponsors, spanPosition, sponsorHref } from '@/lib/sponsors';
import { stockData } from '@/lib/stock-pages';

const TITLE = `股癌業配一覽・${SITE_NAME}`;
const DESCRIPTION = '《股癌》每一集的業配：哪些品牌贊助過、幾次、第一次和最近一次在哪一集，每次主打什麼。非官方粉絲整理。';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/sponsors' },
  ...shareMetadata(TITLE, '/sponsors', DESCRIPTION),
};

export default async function SponsorsPage() {
  const { sponsors: index } = await stockData();
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
  // The strip under each sponsor spans the site's episodes with an ad, oldest to newest
  const dates = all.map((e) => e.publishedAt).sort();
  const [from, to] = [dates[0]!, dates.at(-1)!];
  const unnamed = index.unnamed;
  const episodes = new Set([...all, ...unnamed].map((e) => e.no)).size;

  return (
    <div className="home">
      <div className="stock-head">
        <h1>業配</h1>
        <p className="muted" style={{ margin: 0 }}>
          {episodes} 集裡的業配，共 {sponsors.length} 個品牌，照贊助的集數排。品牌名稱由 AI 從摘要整理，可能有誤聽。
        </p>
      </div>
      <section className="card list" id="sponsor-list">
        <div className="sponsor-row head" aria-hidden="true">
          <span>品牌</span>
          <span className="span-label">
            <span>{formatDate(from).slice(0, 7)}</span>
            <span>{formatDate(to).slice(0, 7)}</span>
          </span>
          <span>集數</span>
        </div>
        {sponsors.map((s) => (
          <Link key={s.slug} className="sponsor-row" href={sponsorHref(s)} prefetch={false}>
            <span className="n">{s.name}</span>
            {/* A dot per episode, placed by date: how often and since when */}
            <span className="dots" role="img" aria-label={`第一次 EP${s.episodes.at(-1)!.no}，最近 EP${s.episodes[0]!.no}`}>
              {s.episodes.map((e) => (
                <i key={e.no} style={{ left: `${spanPosition(e.publishedAt, from, to) * 100}%` }} />
              ))}
            </span>
            <span className="fine">{s.episodes.length} 集</span>
          </Link>
        ))}
      </section>
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
