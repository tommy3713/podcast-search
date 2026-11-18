import Link from 'next/link';
import { Badge, EpName } from '@/components/Badge';
import type { EpisodeListItem } from '@/lib/episodes';
import { formatDate, minutes } from '@/lib/format';

// One episode in a list: the home page's (with its stocks and length) and 內容相近的集數
export function EpisodeRow({ ep, prefetch, stocks = 0 }: { ep: EpisodeListItem; prefetch?: false; stocks?: number }) {
  return (
    <Link className="ep-row" href={`/ep/${ep.no}`} prefetch={prefetch}>
      <Badge title={ep.title} />
      <div style={{ minWidth: 0 }}>
        <EpisodeLine ep={ep} />
        <div className="d">{ep.line}</div>
        {stocks > 0 && ep.stocks.length > 0 && (
          <div className="chips" style={{ marginTop: 6 }}>
            {ep.stocks.slice(0, stocks).map((s, i) => (
              <span key={i} className="chip">
                {s}
              </span>
            ))}
          </div>
        )}
      </div>
      {stocks > 0 && <div className="r">{ep.duration && <span>{minutes(ep.duration)} 分</span>}</div>}
    </Link>
  );
}

// EP<n>, its name when the title isn't an emoji, and its date
export function EpisodeLine({ ep }: { ep: Pick<EpisodeListItem, 'no' | 'title' | 'publishedAt'> }) {
  return (
    <div className="t">
      <span>EP{ep.no}</span>
      <EpName title={ep.title} />
      <span className="fine">{formatDate(ep.publishedAt)}</span>
    </div>
  );
}
