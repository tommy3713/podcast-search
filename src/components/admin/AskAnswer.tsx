import { Fragment } from 'react';
import { type Block, groupBlocks, parseAnswer } from '@/lib/ask/render';

// The episode label a logged line opens with (blocksToText: "EP709｜", "EP700・EP701・EP702 等 5 集｜")
const LABEL = /^((?:EP\d{1,4}・)*EP\d{1,4}(?: 等 \d+ 集)?)｜/;

// A logged answer as /ask showed it: the log keeps the text with each line's episode label
// already in it, but not which passage each [n] was, so citations are numbers, not links.
// Rendered with the page's own parser: lists, bold and [n] only, everything else as text.
export function AskAnswer({ text }: { text: string }) {
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
      return (
        <span key={i} className="cite">
          {p.n}
        </span>
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
