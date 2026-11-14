import fs from 'node:fs';
import path from 'node:path';

// Counts a Whisper prompt's tokens the way Whisper does, so /admin/whisper can keep it within
// what the model reads. multilingual.tiktoken is Whisper's own vocabulary (openai/whisper
// v20240930, whisper/assets/, MIT licence; whisper-large-v3, which Groq runs, uses it for
// text); next.config.ts traces it into the web image. Server only: about 800 KB.

// Whisper keeps the last n_text_ctx / 2 - 1 = 223 tokens of a prompt and silently drops the
// rest (decoding.py), so a longer prompt loses its beginning
export const WHISPER_PROMPT_TOKENS = 223;

// GPT-2's pre-tokenizer, which Whisper's tokenizer uses (tokenizer.py)
const PIECES = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

let ranks: Map<string, number> | undefined;

// byte strings as latin1 keys: one char per byte
function vocab(): Map<string, number> {
  if (ranks) return ranks;
  const file = path.join(process.cwd(), 'src/lib/whisper/multilingual.tiktoken');
  ranks = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const [token, rank] = line.split(' ');
    if (token !== undefined && rank !== undefined) ranks.set(Buffer.from(token, 'base64').toString('latin1'), Number(rank));
  }
  return ranks;
}

// tiktoken's byte pair merge: join the adjacent pair with the lowest rank until none is in
// the vocabulary. How many tokens the piece becomes. Like tiktoken, each pair's rank is kept
// and only the two next to a merge are looked up again, so a long piece (a paragraph without
// punctuation is one) costs a scan per merge rather than a scan of lookups.
function pieceTokens(bytes: string, r: Map<string, number>): number {
  if (r.has(bytes)) return 1;
  const parts = Array.from({ length: bytes.length + 1 }, (_, i) => i);
  // rank of the pair starting at parts[i] (parts[i]..parts[i + 2]); Infinity: none
  const rankAt = (i: number) => (i + 2 < parts.length ? (r.get(bytes.slice(parts[i], parts[i + 2])) ?? Infinity) : Infinity);
  const ranks = parts.map((_, i) => rankAt(i));
  for (;;) {
    let best = -1;
    let bestRank = Infinity;
    for (let i = 0; i < ranks.length; i++) {
      if (ranks[i]! < bestRank) {
        bestRank = ranks[i]!;
        best = i;
      }
    }
    if (best < 0) return parts.length - 1;
    parts.splice(best + 1, 1);
    ranks.splice(best + 1, 1);
    ranks[best] = rankAt(best);
    if (best > 0) ranks[best - 1] = rankAt(best - 1);
  }
}

// Whisper encodes a prompt as " " + prompt.strip() (transcribe.py)
export function whisperTokens(prompt: string): number {
  const r = vocab();
  const text = ` ${prompt.trim()}`;
  let n = 0;
  for (const m of text.matchAll(PIECES)) n += pieceTokens(Buffer.from(m[0], 'utf8').toString('latin1'), r);
  return n;
}
