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

// ── Episode labels ────────────────────────────────────────────────────────────────────
// Each line that cites something opens with the episodes of the sources it cites, worked
// out here rather than written by the model: asked to write them itself, the model put the
// wrong episode on about 4% of answers (an EP662 passage cited under "EP656：", a source
// number matched to the wrong label among 8–30 results). A label and its citations can't
// disagree, and a line citing two episodes says so. The page, the Q&A log and the eval all
// go through labelBlocks, so they see the same text.

const LABEL_MAX = 3; // episodes named in one label; more become "等 N 集"

// The episodes a line cites, in episode order
export function lineEpisodes(b: Block, epOf: ReadonlyMap<number, number>): number[] {
  const eps = new Set<number>();
  for (const p of b.parts) if (p.kind === 'cite' && epOf.has(p.n)) eps.add(epOf.get(p.n)!);
  return [...eps].sort((x, y) => x - y);
}

export function episodeLabel(eps: number[]): string {
  const shown = eps.slice(0, LABEL_MAX).map((e) => `EP${e}`).join('・');
  return eps.length > LABEL_MAX ? `${shown} 等 ${eps.length} 集` : shown;
}

// One episode as the model writes it: EP706, EP706–709, 第 706 集, 706 集, with an optional date
const ONE_EPISODE = String.raw`(?:EP\s?\d{1,4}(?:\s*[-–—~～]\s*(?:EP\s?)?\d{1,4})?|第\s?\d{1,4}\s?集|\d{3,4}\s?集)(?:\s*[（(]?\d{4}-\d{2}-\d{2}[)）]?)?`;
const EPISODE_LIST = String.raw`(?:${ONE_EPISODE}\s*[、,，和與及/／]?\s*)+`;
// A label the model wrote at the start of a line ("EP706：", "EP698、EP699：", "第 709 集｜")
const OWN_LABEL = new RegExp(String.raw`^\s*${EPISODE_LIST}[：:｜|]\s*`, 'i');
// A line that is nothing but episodes and its citations ("EP672 [17]")
const ONLY_EPISODES = new RegExp(String.raw`^\s*${EPISODE_LIST}$`, 'i');
// Prose that opens with episodes ("EP709 說…"), dropped when they are exactly the label's
const LEADING_EPISODES = new RegExp(String.raw`^\s*${EPISODE_LIST}`, 'i');

const namedIn = (text: string) =>
  [...new Set([...text.matchAll(/(?<!\d)\d{3,4}(?!\d)(?!-\d{2}-)/g)].map((m) => Number(m[0])))].filter((n) => n < 1900).sort((a, b) => a - b);

export type LabeledBlock = Block & { eps: number[] };

// The blocks with their episodes, and the start of each citing line cleaned: the model's
// own label taken off, and episodes repeating the label dropped. `typing`: the last block
// is still streaming, so a label the model is writing goes before its first citation
// arrives, instead of showing and then turning into the computed one.
export function labelBlocks(blocks: Block[], epOf: ReadonlyMap<number, number>, typing = false): LabeledBlock[] {
  return blocks.map((b, i) => {
    const eps = lineEpisodes(b, epOf);
    const last = typing && i === blocks.length - 1;
    if (!eps.length && !last) return { ...b, eps };
    // Bold counts as content here, so "EP709 **重點** [1]" isn't a line of only episodes
    const content = b.parts.map((p) => (p.kind === 'cite' ? '' : p.text)).join('');
    if (eps.length && ONLY_EPISODES.test(content)) return { ...b, eps, parts: b.parts.filter((p) => p.kind === 'cite') };
    const [first, ...rest] = b.parts;
    if (first?.kind !== 'text') return { ...b, eps };
    let text = first.text.replace(OWN_LABEL, '');
    const lead = LEADING_EPISODES.exec(text);
    if (eps.length && lead && namedIn(lead[0]).join() === eps.join()) text = text.slice(lead[0].length);
    return { ...b, eps, parts: text ? [{ kind: 'text', text }, ...rest] : rest };
  });
}

// Blocks back to answer text, "- " for list items, **bold** and [n] kept; with `labels`,
// each citing line opens with "EP709｜"
export function blocksToText(blocks: LabeledBlock[], labels: boolean): string {
  return blocks
    .map((b) => {
      const body = b.parts.map((p) => (p.kind === 'text' ? p.text : p.kind === 'bold' ? `**${p.text}**` : `[${p.n}]`)).join('').trimEnd();
      const label = labels && b.eps.length ? `${episodeLabel(b.eps)}｜` : '';
      return `${b.kind === 'li' ? '- ' : ''}${label}${body}`;
    })
    .join('\n');
}

// The answer as the page shows it, as text: for the Q&A log, Telegram and the eval's judge
export function labeledAnswer(raw: string, epOf: ReadonlyMap<number, number>): string {
  return blocksToText(labelBlocks(parseAnswer(raw, new Set(epOf.keys())), epOf), true);
}

// The same without the labels: the episodes the answer names in its own text, which the
// eval's 出處對不上 checks
export function shownWithoutLabels(raw: string, epOf: ReadonlyMap<number, number>): string {
  return blocksToText(labelBlocks(parseAnswer(raw, new Set(epOf.keys())), epOf), false);
}
