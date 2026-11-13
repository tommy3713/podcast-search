import Link from 'next/link';
import { EpName } from '@/components/Badge';
import { ExcerptToggle } from '@/components/Excerpt';
import { PlayTs } from '@/components/StockPlayer';
import { formatDate, monthKey } from '@/lib/format';
import type { PlayPoint } from '@/lib/seek';
import { monthKeyLabel } from '@/lib/stocks';

export type TimelineEpisode = {
  no: number;
  title: string;
  publishedAt: string;
  notes: { t: number; text: string }[];
  // A line above the notes (the ad chapter's title on a sponsor's page)
  chapterTitle?: string;
};

// The episodes a sponsor or topic page lists, newest first, grouped by month (the month
// chart's bars link to #m-<month>), each with its notes as timestamps that play on the page.
// Must be inside a StockPlayer.
export function EpisodeTimeline({
  heading,
  episodes,
  points,
}: {
  heading: string;
  episodes: TimelineEpisode[];
  points: Map<string, PlayPoint | null>;
}) {
  const groups: { key: string; episodes: TimelineEpisode[] }[] = [];
  for (const e of episodes) {
    const key = monthKey(e.publishedAt);
    if (groups.at(-1)?.key !== key) groups.push({ key, episodes: [] });
    groups.at(-1)!.episodes.push(e);
  }
  return (
    <section className="card list" id="stock-eps">
      <div className="list-head">
        <h3>
          {heading}
          <span className="fine">共 {episodes.length} 集</span>
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
              {e.chapterTitle && (
                <div className="ch">
                  <span className="fine">章節</span>
                  {e.chapterTitle}
                </div>
              )}
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
  );
}
