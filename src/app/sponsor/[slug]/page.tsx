import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EpName } from '@/components/Badge';
import { ExcerptToggle } from '@/components/Excerpt';
import { MonthChart } from '@/components/MonthChart';
import { PlayTs, StockPlayer } from '@/components/StockPlayer';
import { formatDate, monthKey } from '@/lib/format';
import { shareMetadata } from '@/lib/seo';
import { readDb } from '@/lib/server-db';
import { averageGapDays, findSponsor, SPONSOR_INDEX_MIN_EPISODES, type Sponsor, type SponsorEpisode, sponsorHref } from '@/lib/sponsors';
import { stockData, stockPlayPoints } from '@/lib/stock-pages';
import { chartBars, monthKeyLabel, stockMonths } from '@/lib/stocks';

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
  const bars = sponsor.episodes.length >= CHART_MIN_EPISODES ? chartBars(stockMonths(sponsor, liveMonths)) : [];
  const points = stockPlayPoints(await readDb(), sponsor);
  const audio = Object.fromEntries(sponsor.episodes.map((e) => [e.no, e.audioUrl]));
  const groups: { key: string; episodes: SponsorEpisode[] }[] = [];
  for (const e of sponsor.episodes) {
    const key = monthKey(e.publishedAt);
    if (groups.at(-1)?.key !== key) groups.push({ key, episodes: [] });
    groups.at(-1)!.episodes.push(e);
  }

  return (
    <StockPlayer audio={audio}>
      <div className="home">
        <div>
          <Link className="back" href="/sponsors">
            ← 所有業配
          </Link>
          <div className="stock-head">
            <h1>{sponsor.name}</h1>
            <div className="meta">
              <span>業配 {sponsor.episodes.length} 集</span>
              {first.no !== latest.no && (
                <span>
                  第一次 <Link href={`/ep/${first.no}`}>EP{first.no}</Link>・{formatDate(first.publishedAt)}
                </span>
              )}
              <span>
                最近 <Link href={`/ep/${latest.no}`}>EP{latest.no}</Link>・{formatDate(latest.publishedAt)}
              </span>
              {gap !== null && <span>平均每 {gap} 天一次</span>}
            </div>
          </div>
        </div>
        {bars.length > 0 && <MonthChart bars={bars} what="業配" />}
        <section className="card list" id="stock-eps">
          <div className="list-head">
            <h3>
              每一次主打什麼
              <span className="fine">共 {sponsor.episodes.length} 集</span>
            </h3>
          </div>
          {groups.map((g) => (
            <div key={g.key} className="month-group">
              <h2 className="month" id={`m-${g.key}`}>
                {monthKeyLabel(g.key)}
                <span className="fine">　{g.episodes.length} 集</span>
              </h2>
              {g.episodes.map((e) => (
                <div key={e.no} className="stock-ep">
                  <div className="t">
                    <Link href={`/ep/${e.no}`}>
                      EP{e.no}
                      <EpName title={e.title} />
                    </Link>
                    <span className="fine">{formatDate(e.publishedAt)}</span>
                  </div>
                  <div className="ch">
                    <span className="fine">章節</span>
                    {e.chapterTitle}
                  </div>
                  <ul className="keypts">
                    {e.notes.map((n, i) => (
                      <li key={i}>
                        <PlayTs episodeNo={e.no} t={n.t} point={points.get(`${e.no}:${n.t}`) ?? null} />
                        <span>{n.text}</span>
                      </li>
                    ))}
                  </ul>
                  <ExcerptToggle episodeNo={e.no} t={e.notes[0]!.t} />
                </div>
              ))}
            </div>
          ))}
        </section>
        <p className="fine" style={{ margin: 0 }}>
          只算節目摘要裡標成業配的段落，品牌名稱由 AI 從摘要整理，可能有誤聽。內容以原節目為準。
        </p>
      </div>
    </StockPlayer>
  );
}
