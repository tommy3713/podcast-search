import Link from 'next/link';
import { OnThisDaySwipe } from '@/components/OnThisDaySwipe';
import { formatDate } from '@/lib/format';
import type { OnThisDay as Item } from '@/lib/on-this-day';
import { formatTimestamp } from '@/lib/summary';

// 那年今日 on the home page (src/lib/on-this-day.ts): one card, the years along its top as
// radios (CSS shows the checked one's panel: no JavaScript), each panel the episode's date,
// number and line (one link to it), its first key points and stocks. Wide screens get the
// year large down the panel's side; phones swipe between the years (OnThisDaySwipe.tsx).
// The links don't prefetch: dynamic /ep URLs on the home page, which most visitors load once.
const RADIO = 'otd-year';

export function OnThisDay({ items, today }: { items: Item[]; today: string }) {
  if (!items.length) return null;
  const [, m, d] = today.split('-');
  const tabs = (
    <div className="otd-tabbar" role="radiogroup" aria-label="選年份">
      {items.map((x, i) => (
        <label key={x.no}>
          <input type="radio" name={RADIO} value={x.no} defaultChecked={i === 0} />
          <b>{x.year}</b>
          <span>{x.yearsAgo} 年前</span>
        </label>
      ))}
    </div>
  );
  return (
    <section className="otd" aria-labelledby="otd-title">
      <div className="otd-head">
        <h3 id="otd-title">那年今日</h3>
        <span className="fine">
          {Number(m)}/{Number(d)}・往年這幾天的集數
        </span>
        {items.length > 1 && (
          <span className="fine otd-hint" aria-hidden="true">
            左右滑動切換年份
          </span>
        )}
      </div>
      <OnThisDaySwipe name={RADIO} tabs={tabs}>
        {items.map((x) => (
          <article key={x.no} className="otd-panel">
            <div className="otd-panel-side" aria-hidden="true">
              <span className="otd-bigyear">{x.year}</span>
            </div>
            <div className="otd-panel-main">
              {/* The date, the number and the line: one link to the episode */}
              <Link className="otd-link" href={`/ep/${x.no}`} prefetch={false}>
                <span className="otd-top">
                  <span className="fine">{formatDate(x.publishedAt)}</span>
                  <span className="otd-ep">EP{x.no} →</span>
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
            </div>
          </article>
        ))}
      </OnThisDaySwipe>
    </section>
  );
}
