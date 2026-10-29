// The answer is plain text from the model. Only three things are interpreted:
// lines starting "- " (list items), **bold**, and [n] citations of server sources.
// Everything else is rendered as text, so the model can't produce links or HTML.

export type Inline = { kind: 'text'; text: string } | { kind: 'bold'; text: string } | { kind: 'cite'; n: number };
export type Block = { kind: 'p' | 'li'; parts: Inline[] };

export function parseAnswer(raw: string, known: ReadonlySet<number>, streaming = false): Block[] {
  let text = raw;
  if (streaming) {
    // Hide a citation or bold marker that is still being typed
    text = text.replace(/\[\d*$/, '');
    if ((text.match(/\*\*/g) ?? []).length % 2) text = text.replace(/\*\*(?!.*\*\*)/s, '');
  }
  const blocks: Block[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const li = /^[-*•]\s+/.exec(trimmed);
    blocks.push({ kind: li ? 'li' : 'p', parts: inline(li ? trimmed.slice(li[0].length) : trimmed, known) });
  }
  return blocks;
}

function inline(s: string, known: ReadonlySet<number>): Inline[] {
  const parts: Inline[] = [];
  const re = /\*\*(.+?)\*\*|\[(\d{1,3}(?:\s*[,，]\s*\d{1,3})*)\]/g;
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) parts.push({ kind: 'text', text: s.slice(last, m.index) });
    if (m[1] !== undefined) parts.push({ kind: 'bold', text: m[1] });
    else {
      // [1, 3] → two citations; numbers the server never sent are dropped
      for (const n of m[2]!.split(/[,，]/).map((x) => Number(x.trim()))) if (known.has(n)) parts.push({ kind: 'cite', n });
    }
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push({ kind: 'text', text: s.slice(last) });
  return parts;
}

// Sources in the order the answer first cites them
export function citedOrder(blocks: Block[]): number[] {
  const seen: number[] = [];
  for (const b of blocks) for (const p of b.parts) if (p.kind === 'cite' && !seen.includes(p.n)) seen.push(p.n);
  return seen;
}

// SSE: complete "data: ..." events in buf, plus the unfinished remainder
export function splitEvents(buf: string): { events: string[]; rest: string } {
  const chunks = buf.split('\n\n');
  const rest = chunks.pop() ?? '';
  const events = chunks.flatMap((c) => c.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)));
  return { events, rest };
}
