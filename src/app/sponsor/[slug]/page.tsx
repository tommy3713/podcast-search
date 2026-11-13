import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EpisodeTimeline } from '@/components/EpisodeTimeline';
import { MonthChart } from '@/components/MonthChart';
import { StockPlayer } from '@/components/StockPlayer';
import { StatRow } from '@/components/TopicCard';
import { formatDate } from '@/lib/format';
import { shareMetadata } from '@/lib/seo';
import { readDb } from '@/lib/server-db';
import { averageGapDays, findSponsor, SPONSOR_INDEX_MIN_EPISODES, type Sponsor, sponsorHref } from '@/lib/sponsors';
import { stockData, stockPlayPoints } from '@/lib/stock-pages';
import { chartBars, stockMonths } from '@/lib/stocks';
import { spanFrom } from '@/lib/topics-overview';

type Props = { params: Promise<{ slug: string }> };

const CHART_MIN_EPISODES = 3;

// No loading.tsx: a skeleton would fix the status at 200 before the slug is looked up
async function load(params: Props['params']) {
  let segment = (await params).slug;
  try {
    segment = decodeURIComponent(segment);
  } catch {
    // A stray % in the URL: look up what was sent
  }
  const { sponsors, liveMonths } = await stockData();
  const sponsor = findSponsor(sponsors, segment);
  return sponsor && { sponsor, liveMonths };
}

function title(s: Sponsor): string {
  return `股癌 ${s.name} 業配｜${s.episodes.length} 集`;
}

function description(s: Sponsor): string {
  const first = s.episodes.at(-1)!;
  const eps = s.episodes.slice(0, 3).map((e) => `EP${e.no}`).join('、');
  return `《股癌》的 ${s.name} 業配：從 EP${first.no}（${formatDate(first.publishedAt).slice(0, 10)}）起共 ${s.episodes.length} 集，最近是 ${eps}。每一集主打什麼、在第幾分鐘。非官方粉絲整理。`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const sponsor = (await load(params))?.sponsor;
  if (!sponsor) return { title: '找不到這一頁' };
  const url = sponsorHref(sponsor);
  return {
    title: { absolute: title(sponsor) },
    description: description(sponsor),
    alternates: { canonical: url },
    ...(sponsor.episodes.length < SPONSOR_INDEX_MIN_EPISODES ? { robots: { index: false, follow: true } } : {}),
    ...shareMetadata(title(sponsor), url, description(sponsor)),
  };
}

export default async function SponsorPage({ params }: Props) {
  const found = await load(params);
  if (!found) notFound();
  const { sponsor, liveMonths } = found;
  const [latest, first] = [sponsor.episodes[0]!, sponsor.episodes.at(-1)!];
  const gap = averageGapDays(sponsor);
  // Its own span: from its first ad to the site's newest month
  const bars = sponsor.episodes.length >= CHART_MIN_EPISODES ? chartBars(stockMonths(sponsor, spanFrom(liveMonths, first.publishedAt))) : [];
  const points = stockPlayPoints(await readDb(), sponsor);
  const audio = Object.fromEntries(sponsor.episodes.map((e) => [e.no, e.audioUrl]));

  return (
    <StockPlayer audio={audio}>
      <div className="home topics-page">
        <Link className="back" href="/sponsors" prefetch={false}>
          ← 所有業配
        </Link>
        <div className="stock-head">
          <h1>{sponsor.name}</h1>
          {first.no !== latest.no && (
            <p className="muted" style={{ margin: 0 }}>
              第一次在 <Link href={`/ep/${first.no}`}>EP{first.no}</Link>（{formatDate(first.publishedAt)}）
            </p>
          )}
        </div>
        <StatRow
          stats={[
            { label: '業配', value: sponsor.episodes.length, unit: '集' },
            ...(gap !== null ? [{ label: '平均每', value: gap, unit: '天一次' }] : []),
            { label: `${first.no === latest.no ? '只在' : '最近一集'}・${formatDate(latest.publishedAt).slice(0, 10)}`, value: latest.no, prefix: 'EP', href: `/ep/${latest.no}` },
          ]}
        />
        {bars.length > 0 && <MonthChart bars={bars} what="業配" />}
        <EpisodeTimeline heading="每一次主打什麼" episodes={sponsor.episodes} points={points} />
        <p className="fine" style={{ margin: 0 }}>
          只算節目摘要裡標成業配的段落，品牌名稱由 AI 從摘要整理，可能有誤聽。內容以原節目為準。
        </p>
      </div>
    </StockPlayer>
  );
}
