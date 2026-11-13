import Link from 'next/link';
import { ExcerptToggle } from '@/components/Excerpt';
import { PlayTs } from '@/components/StockPlayer';
import { formatDate, monthKey } from '@/lib/format';
import type { PlayPoint } from '@/lib/seek';
import { monthKeyLabel } from '@/lib/stocks';
import type { TopicEpisode, TopicNote } from '@/lib/topics';

// The host's words in 「」, the name it came up as beside them; a bare name without marks
export function Said({ note }: { note: TopicNote }) {
  return (
    <>
      {note.quoted ? `「${note.text}」` : note.text}
      {note.as && <span className="qas">{note.as}</span>}
    </>
  );
}

// What he said about one thing, as one wall of cards (after the library's Bento 評價牆): the
// quote large, what the episode was about in a line, and the timestamp that plays on the page.
// Newest first. Not split by month, which leaves rows of one card: the first card of each
// month carries the month chart's anchor (#m-<month>) and the month's name. Must be inside a
// StockPlayer.
export function QuoteWall({ episodes, points }: { episodes: TopicEpisode[]; points: Map<string, PlayPoint | null> }) {
  let month = '';
  return (
    <section className="quote-wall" aria-label="每一集說了什麼">
      {episodes.map((e, i) => {
        const [lead, ...more] = e.notes;
        const key = monthKey(e.publishedAt);
        const first = key !== month;
        month = key;
        return (
          <article key={e.no} id={first ? `m-${key}` : undefined} className="card qcard" data-vt-item style={{ ['--i' as string]: i }}>
            {first && <div className="qmonth">{monthKeyLabel(key)}</div>}
            <blockquote className={lead!.quoted ? undefined : 'bare'}>
              <Said note={lead!} />
            </blockquote>
            {more.length > 0 && (
              <ul className="qmore">
                {more.map((n, k) => (
                  <li key={k}>
                    <PlayTs episodeNo={e.no} t={n.t} point={points.get(`${e.no}:${n.t}`) ?? null} />
                    <span>
                      <Said note={n} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {e.line && <p className="qline">{e.line}</p>}
            <footer>
              <Link href={`/ep/${e.no}`} className="qep">
                EP{e.no}
              </Link>
              <span className="fine">{formatDate(e.publishedAt)}</span>
              <PlayTs episodeNo={e.no} t={lead!.t} point={points.get(`${e.no}:${lead!.t}`) ?? null} />
            </footer>
            <ExcerptToggle episodeNo={e.no} t={lead!.t} />
          </article>
        );
      })}
    </section>
  );
}
