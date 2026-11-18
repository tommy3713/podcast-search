import Link from 'next/link';
import { EpisodeLine, EpisodeRow } from '@/components/EpisodeRow';
import type { EpisodeListItem } from '@/lib/episodes';

type Adjacent = { prev: EpisodeListItem | null; next: EpisodeListItem | null };

// Beside ← 所有集數 at the top of an episode's page; the page's one navigation landmark for
// 上一集 / 下一集 (the card at the bottom repeats them inside the 繼續看 section)
export function EpisodeStepper({ prev, next }: Adjacent) {
  if (!prev && !next) return null;
  return (
    <nav className="ep-stepper" aria-label="上一集與下一集">
      {prev && (
        <Link href={`/ep/${prev.no}`} rel="prev" title={prev.line}>
          ‹ EP{prev.no}
        </Link>
      )}
      {next && (
        <Link href={`/ep/${next.no}`} rel="next" title={next.line}>
          EP{next.no} ›
        </Link>
      )}
    </nav>
  );
}

function Side({ ep, dir }: { ep: EpisodeListItem | null; dir: 'prev' | 'next' }) {
  const label = dir === 'prev' ? '‹ 上一集' : '下一集 ›';
  if (!ep) {
    return (
      <div className={`ep-side ${dir} none`}>
        <span className="eyebrow">{label}</span>
        <span className="fine">{dir === 'next' ? '這是最新一集' : '這是最早的一集'}</span>
      </div>
    );
  }
  return (
    <Link className={`ep-side ${dir}`} href={`/ep/${ep.no}`}>
      <span className="eyebrow">{label}</span>
      <EpisodeLine ep={ep} />
      <span className="d">{ep.line}</span>
    </Link>
  );
}

// Under an episode's tabs, so both the summary and the transcript end somewhere to go next.
// The related ones don't prefetch: four dynamic routes per page view, rarely all clicked.
export function EpisodeMore({ prev, next, related }: Adjacent & { related: EpisodeListItem[] }) {
  if (!prev && !next && related.length === 0) return null;
  return (
    <section className="ep-more" aria-label="繼續看">
      {(prev || next) && (
        <div className="card ep-sides">
          <Side ep={prev} dir="prev" />
          <Side ep={next} dir="next" />
        </div>
      )}
      {related.length > 0 && (
        <div className="card list">
          <div className="list-head">
            <h3>
              內容相近的集數
              <span className="fine">依每集重點的內容比對</span>
            </h3>
          </div>
          {related.map((e) => (
            <EpisodeRow key={e.no} ep={e} prefetch={false} />
          ))}
        </div>
      )}
    </section>
  );
}
