import Link from 'next/link';
import { formatDate } from '@/lib/format';
import type { OnThisDay as Item } from '@/lib/on-this-day';
import { formatTimestamp } from '@/lib/summary';

// 那年今日 on the home page (src/lib/on-this-day.ts): a card per earlier year with what that
// episode was about. Phones swipe through them (scroll-snap, the next card peeking in); wider
// screens see them all in a grid. CSS only. The links don't prefetch: a dozen dynamic /ep
// URLs on the home page, which most visitors load once.
export function OnThisDay({ items, today }: { items: Item[]; today: string }) {
  if (!items.length) return null;
  const [, m, d] = today.split('-');
  return (
    <section className="otd" aria-labelledby="otd-title">
      <div className="otd-head">
        <h3 id="otd-title">那年今日</h3>
        <span className="fine">
          {Number(m)}/{Number(d)}・往年這幾天的集數
        </span>
        {items.length > 1 && (
          <span className="fine otd-hint" aria-hidden="true">
            滑動看更多 →
          </span>
        )}
      </div>
      <div className="otd-track">
        {items.map((x) => (
          <article key={x.no} className="card otd-card">
            {/* One link to the episode: its date row and line together */}
            <Link className="otd-link" href={`/ep/${x.no}`} prefetch={false}>
              <span className="otd-top">
                <span className="pill info">{x.yearsAgo} 年前</span>
                <span className="fine">{formatDate(x.publishedAt)}</span>
                <span className="otd-ep">EP{x.no}</span>
              </span>
              {x.line && <span className="otd-line">{x.line}</span>}
            </Link>
            {x.keys.length > 0 && (
              <ul className="otd-keys">
                {x.keys.map((k, i) => (
                  <li key={i}>
                    <Link className="ts" href={`/ep/${x.no}?t=${k.t}`} prefetch={false}>
                      {formatTimestamp(k.t)}
                    </Link>
                    <span>{k.text}</span>
                  </li>
                ))}
              </ul>
            )}
            {x.stocks.length > 0 && (
              <div className="chips otd-stocks">
                {x.stocks.map((s) => (
                  <span key={s} className="chip" title={s}>
                    {s}
                  </span>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
