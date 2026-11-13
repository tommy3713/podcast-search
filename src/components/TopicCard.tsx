import Link from 'next/link';
import type { ReactNode } from 'react';
import { CountUp } from '@/components/TopicsMotion';

export type TopicCardProps = {
  href: string;
  label: string;
  count: number;
  unit: string;
  big?: boolean;
  // Drawn on the server: a Sparkline, TopBars or DotStrip
  preview: ReactNode;
  blurb?: string;
  // Plain facts under the blurb
  facts?: string[];
  samples?: { href: string; name: string }[];
  // Its place in the grid, for the staggered rise
  i: number;
};

// A card of the bento on /topics and the pages under it (after Hannah's Motion Library): a
// preview on top, then the name, a number that counts up, and what is in it. The whole card
// links to `href`; the sample chips above that link go to their own pages. Inside a
// SpotlightGrid, the border lights up around the pointer.
export function TopicCard({ href, label, count, unit, big, preview, blurb, facts, samples, i }: TopicCardProps) {
  return (
    <section className={`card tcard${big ? ' big' : ''}`} style={{ ['--i' as string]: i }}>
      <div className="tpreview">{preview}</div>
      <div className="tbody">
        <h2>
          <Link href={href} prefetch={false}>
            {label}
          </Link>
          <span className="tcount">
            <CountUp value={count} />
            <span className="fine">{unit}</span>
          </span>
        </h2>
        {blurb && <p className="muted">{blurb}</p>}
        {facts && facts.length > 0 && (
          <ul className="tfacts">
            {facts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
        {samples && samples.length > 0 && (
          <div className="chips">
            {samples.map((s) => (
              <Link key={s.href} className="chip" href={s.href} prefetch={false}>
                {s.name}
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// The strip of what the newest episodes brought up, sliding by (after the library's 無限捲動卡片
// 牆). Below `min` items it just sits there: too few to fill the strip twice over.
export function Marquee({ items, label = '最近提到', min = 8 }: { items: { href: string; label: string; kind?: string }[]; label?: string; min?: number }) {
  if (items.length === 0) return null;
  const still = items.length < min;
  return (
    <section className={`marquee${still ? ' still' : ''}`} aria-label={label}>
      <span className="marquee-label">{label}</span>
      <div className="marquee-view">
        <div className="marquee-track" style={{ ['--n' as string]: items.length }}>
          {(still ? [0] : [0, 1]).map((copy) => (
            // The second copy only closes the loop
            <div key={copy} className="marquee-set" aria-hidden={copy === 1 || undefined}>
              {items.map((r) => (
                <Link key={r.href} href={r.href} prefetch={false} tabIndex={copy === 1 ? -1 : undefined} className="chip">
                  {r.kind && <span className="fine">{r.kind}</span>}
                  {r.label}
                </Link>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// A row of numbers for the top of a page, counting up
export function StatRow({ stats }: { stats: { label: string; value: number; unit?: string; prefix?: string; href?: string }[] }) {
  return (
    <dl className="stat-row">
      {stats.map((s) => (
        <div key={s.label}>
          <dt>{s.label}</dt>
          <dd>
            {s.prefix && <span className="pre">{s.prefix}</span>}
            {/* A number with a prefix names something (EP713): it doesn't count up */}
            {s.href ? (
              <Link href={s.href} prefetch={false}>
                {s.prefix ? s.value : <CountUp value={s.value} />}
              </Link>
            ) : s.prefix ? (
              s.value
            ) : (
              <CountUp value={s.value} />
            )}
            {s.unit && <span className="fine">{s.unit}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
