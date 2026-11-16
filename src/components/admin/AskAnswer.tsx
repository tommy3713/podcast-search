import Link from 'next/link';
import { Fragment } from 'react';
import type { LoggedSource } from '@/lib/ask/record';
import { type Block, groupBlocks, parseAnswer } from '@/lib/ask/render';
import { formatTimestamp } from '@/lib/summary';

// The episode label a logged line opens with (blocksToText: "EP709｜", "EP700・EP701・EP702 等 5 集｜")
const LABEL = /^((?:EP\d{1,4}・)*EP\d{1,4}(?: 等 \d+ 集)?)｜/;

// A logged answer as /ask showed it: the log keeps the text with each line's episode label
// already in it, and (since sources_json) the passages it cites, so [n] links to where it
// is; on older rows citations stay numbers. Rendered with the page's own parser: lists, bold
// and [n] only, everything else as text.
export function AskAnswer({ text, sources }: { text: string; sources: LoggedSource[] | null }) {
  const byN = new Map((sources ?? []).map((s) => [s.n, s]));
  const groups = groupBlocks(parseAnswer(text, 'all'));
  const parts = (b: Block) =>
    b.parts.map((p, i) => {
      if (p.kind === 'text') {
        const label = i === 0 ? LABEL.exec(p.text) : null;
        if (!label) return <Fragment key={i}>{p.text}</Fragment>;
        return (
          <Fragment key={i}>
            <span className="eplabel">{label[1]}</span>
            {p.text.slice(label[0].length)}
          </Fragment>
        );
      }
      if (p.kind === 'bold') return <b key={i}>{p.text}</b>;
      const s = byN.get(p.n);
      if (!s) {
        return (
          <span key={i} className="cite">
            {p.n}
          </span>
        );
      }
      return (
        <a key={i} className="cite" href={`#src-${s.n}`} aria-label={`出處 ${s.n}：EP${s.ep} ${formatTimestamp(s.t)}`}>
          {p.n}
        </a>
      );
    });
  return groups.map((g, i) =>
    g.kind === 'ul' ? (
      <ul key={i}>
        {g.items.map((b, j) => (
          <li key={j}>{parts(b)}</li>
        ))}
      </ul>
    ) : (
      <p key={i}>{parts(g.items[0]!)}</p>
    ),
  );
}

// The passages the answer cites, in full as logged, to check each against the line citing it
export function AskSources({ sources }: { sources: LoggedSource[] }) {
  return (
    <ol className="admin-ask-sources">
      {sources.map((s) => (
        <li key={s.n} id={`src-${s.n}`}>
          <div className="admin-ask-src-head">
            <span className="cite">{s.n}</span>
            <Link href={`/ep/${s.ep}?t=${Math.floor(s.t)}`} target="_blank">
              EP{s.ep} {formatTimestamp(s.t)}
            </Link>
            {s.label && <span className="pill flat">{s.label}</span>}
          </div>
          <p>{s.text}</p>
        </li>
      ))}
    </ol>
  );
}
