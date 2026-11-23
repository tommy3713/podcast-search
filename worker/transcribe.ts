import fs from 'node:fs';
import path from 'node:path';
import type { Segment } from '@/lib/segments.ts';
import { type AudioPart, cutClip } from './audio.ts';
import { requireEnv } from './config.ts';
import { normalizeText, WHISPER_PROMPT } from './text.ts';

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

type GroqSegment = { start: number; end: number; text: string; no_speech_prob?: number; avg_logprob?: number };

// Gaps longer than this get a second pass on just that span
const MIN_GAP_SECONDS = 12;
// Groq bills at least 10 seconds per request
const MIN_BILLED_SECONDS = 10;

// A segment this long with fewer characters per second than this is suspect: speech runs
// about 6.8 a second, and a failed window comes back as one sentence spanning all 30 s.
const SPARSE_MIN_SECONDS = 15;
const MIN_CHARS_PER_SECOND = 3;
// The prompt read back: characters in distinct runs of 4+ found in the prompt, from this
// many on and making up this share of the text. The real opening 歡迎收聽股癌，我是謝孟恭
// is 11, and 台積電、蘋果、Google、Meta、特斯拉 read back 15.
const ECHO_MIN_RUN = 4;
const ECHO_MIN_CHARS = 14;
const ECHO_MIN_SHARE = 0.4;
// A known hallucination this short is invented whole; a longer segment holding one also
// holds speech (歡迎收看。我今天有個新的想法…), so it is kept when no pass does better
const KNOWN_MAX_CHARS = 30;
// A suspect segment with fewer real characters than this is dropped when no pass finds
// anything better: empty beats invented text, which search and Q&A would index
const MIN_KEPT_CHARS = 4;

// Sentences Whisper learned from subtitle credits and video outros; this podcast never says
// them. Taken from the live transcripts (EP252 1:17 lost 30 s of a story to 請關注我們的頻道).
const HALLUCINATIONS = [
  /明鏡與點點|點點欄目|不吝點[贊讚賞]/,
  /amara\.org/i,
  /字幕(由|提供|—|by|志願)/i,
  /獨播劇場|yoyo television/i,
  /(訂閱|按讚|點贊|分享|轉發)[、，,\s]*(訂閱|按讚|點贊|分享|轉發)[、，,\s]*(訂閱|按讚|點贊|分享|轉發)/,
  /關注我們的頻道|請(關注|留意)下方|小鈴鐺/,
  // Not 是由: 本集節目是由 X 贊助 is a real sponsor line
  /^(這次|本期|本集)的?(節目|內容|視頻|影片|訪問|報導|報道)是(為了|關於)/,
  /歡迎收看|(謝謝|感謝)(觀看|收看)/,
];

// The Whisper prompt and the text_fixes rules to use (worker/repo.ts transcriptionSettings);
// the defaults are the built-in prompt and no rules
export type TranscribeOptions = { prompt?: string; rules?: [string, string][] };

// Returns segments with episode-relative times, plus the audio seconds Groq will bill.
export async function transcribe(parts: AudioPart[], opts: TranscribeOptions = {}): Promise<{ segments: Segment[]; billedSeconds: number }> {
  const prompt = opts.prompt ?? WHISPER_PROMPT;
  const rules = opts.rules ?? [];
  const all: Segment[] = [];
  let billedSeconds = 0;
  for (const part of parts) {
    const segs = clean(await transcribeFile(part.file, prompt), 0, rules);
    billedSeconds += Math.max(part.duration, MIN_BILLED_SECONDS);
    const r = await repairPart(part, segs, { prompt, judge: prompt, rules }, new Set());
    billedSeconds += r.billedSeconds;
    if (r.windows) console.log(`transcribe: ${describeRepair(r)}`);
    all.push(...shift(r.segments, part.offset));
  }
  return { segments: dropLoops(all), billedSeconds };
}

export type RepairOutcome = 'recovered' | 'dropped' | 'kept';
// A window transcribed again: what it held before and after. A gap nothing was found in isn't one.
export type RepairChange = { start: number; end: number; outcome: RepairOutcome; before: Segment[]; after: Segment[] };
export type Repair = { segments: Segment[]; billedSeconds: number; windows: number; suspects: number; changes: RepairChange[] };

export type RepairOptions = TranscribeOptions & {
  // The prompt the saved transcript was made with, which its segments are judged by (a read-back
  // of an older prompt is still one); the new passes get `prompt`. Default: `prompt`.
  judgePrompt?: string;
  // Segments never suspect: an admin's corrections, which may be short words over a long span
  keep?: (s: Segment) => boolean;
};

// The prompt and rules the passes get, and the prompt the segments already there are judged by
type PassSettings = { prompt: string; judge: string; rules: [string, string][] };

// Repairs a transcript already saved (episode-relative times, as in segments_json) the way
// transcribe() repairs a new one, against the episode's audio parts (worker/repair.ts, for
// episodes transcribed before suspect segments were handled). Segments outside every window
// come back as they were.
export async function repairTranscript(parts: AudioPart[], segments: Segment[], opts: RepairOptions = {}): Promise<Repair> {
  const prompt = opts.prompt ?? WHISPER_PROMPT;
  const settings: PassSettings = { prompt, judge: opts.judgePrompt ?? prompt, rules: opts.rules ?? [] };
  const out: Repair = { segments: [], billedSeconds: 0, windows: 0, suspects: 0, changes: [] };
  for (const [i, part] of parts.entries()) {
    const next = parts[i + 1];
    const mine = segments.filter((s) => s.start >= part.offset && (!next || s.start < next.offset));
    const local = shift(mine, -part.offset);
    // Segments that come back untouched are the saved ones, times exactly as they were
    const saved = new Map(local.map((s, j) => [s, mine[j]!]));
    const back = (segs: Segment[]) => segs.map((s) => saved.get(s) ?? shift([s], part.offset)[0]!);
    const keep = new Set(local.filter((_, j) => opts.keep?.(mine[j]!)));
    const r = await repairPart(part, local, settings, keep);
    out.billedSeconds += r.billedSeconds;
    out.windows += r.windows;
    out.suspects += r.suspects;
    out.segments.push(...back(r.segments));
    out.changes.push(
      ...r.changes.map((c) => ({ ...c, start: round1(c.start + part.offset), end: round1(c.end + part.offset), before: back(c.before), after: back(c.after) })),
    );
  }
  out.segments.sort((a, b) => a.start - b.start);
  return { ...out, segments: dropLoops(out.segments) };
}

export function describeRepair(r: Pick<Repair, 'windows' | 'suspects' | 'changes'>): string {
  const n = (o: RepairOutcome) => r.changes.filter((c) => c.outcome === o).length;
  return `retried ${r.windows} window(s) (${r.suspects} suspect): ${n('recovered')} recovered, ${n('dropped')} dropped`;
}

// The spans a saved transcript would have transcribed again, with what they hold. `prompt`:
// the one it was made with.
export function planWindows(
  segments: Segment[],
  duration: number,
  prompt: string,
  keep: (s: Segment) => boolean = () => false,
): { start: number; end: number; before: Segment[] }[] {
  const kept = new Set(segments.filter(keep));
  return windowsOf(segments, duration, prompt, kept).windows.map((w) => ({ start: w.start, end: w.end, before: w.original }));
}

// Sent as one long file, Whisper sometimes fails whole 30s windows of clear speech: it returns
// nothing for them (EP709 lost 14), or one invented sentence spanning them (findSuspects; on
// EP714 2–4 a run, in different places each run). Those spans transcribe fine on their own,
// without the prompt when it gets in the way. `segs` and the result are part-relative; the
// segments in `keep` are never suspect.
async function repairPart(part: AudioPart, segs: Segment[], settings: PassSettings, keep: Set<Segment>): Promise<Repair> {
  const { windows, suspects } = windowsOf(segs, part.duration, settings.judge, keep);
  const segments = segs.filter((s) => !suspects.includes(s));
  // A pass's segment centred inside one of these says again what it says
  const neighbours = [...segments];
  const changes: RepairChange[] = [];
  let billedSeconds = 0;
  for (const w of windows) {
    const r = await redoWindow(part.file, w, settings, neighbours);
    billedSeconds += r.billedSeconds;
    segments.push(...r.segments);
    const outcome: RepairOutcome | null = r.segments === w.original ? (w.original.length ? 'kept' : null) : r.segments.length ? 'recovered' : 'dropped';
    if (outcome) changes.push({ start: w.start, end: w.end, outcome, before: w.original, after: r.segments });
  }
  segments.sort((a, b) => a.start - b.start);
  return { segments, billedSeconds, windows: windows.length, suspects: suspects.length, changes };
}

function windowsOf(segs: Segment[], duration: number, prompt: string, keep: Set<Segment>): { windows: Window[]; suspects: Segment[] } {
  const suspects = findSuspects(segs, prompt).filter((s) => !keep.has(s));
  const windows = mergeWindows([
    ...findGaps(segs, duration).map((g) => ({ ...g, original: [] })),
    ...suspects.map((s) => ({ start: s.start, end: s.end, original: [s] })),
  ]);
  return { windows, suspects };
}

function shift(segs: Segment[], by: number): Segment[] {
  return segs.map((s) => ({ ...s, start: round1(s.start + by), end: round1(s.end + by) }));
}

// A span to transcribe again on its own: a gap (no original) or suspect segments
type Window = { start: number; end: number; original: Segment[] };

// Whisper's segments can overlap, and so can their windows; a pass's segment in the shared
// span would then go in twice
export function mergeWindows(windows: Window[]): Window[] {
  const out: Window[] = [];
  for (const w of [...windows].sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (last && w.start < last.end) {
      last.end = Math.max(last.end, w.end);
      last.original = [...last.original, ...w.original];
    } else out.push({ ...w });
  }
  return out;
}

// Transcribes the window's span alone, with the prompt and, when that still comes back
// thin, without it (on EP714 alone with the prompt recovered 2 of 4 failed windows, without
// it 4 of 4). Returns what goes in the window's place: the better pass when it has more
// real characters than the original, nothing when the original is invented (a known
// hallucination or the prompt read back, never only slow) and the pass without the prompt
// didn't hear the same words there, else the original.
async function redoWindow(
  file: string,
  w: Window,
  { prompt, judge, rules }: PassSettings,
  neighbours: Segment[],
): Promise<{ segments: Segment[]; billedSeconds: number }> {
  // A gap gets a second each side so words at its edges aren't cut. A suspect segment is cut
  // as it is: its neighbours hold the words around it, and padding a 3 s segment's clip by
  // 2 s brings them back a second time.
  const pad = w.original.length ? 0 : 1;
  const start = Math.max(0, w.start - pad);
  const seconds = w.end + pad - start;
  const clip = `${file}.redo${Math.round(start)}.mp3`;
  await cutClip(file, start, seconds, clip);
  let billedSeconds = 0;
  try {
    const mid = (s: Segment) => (s.start + s.end) / 2;
    const pass = async (p: string | undefined) => {
      const raw = await transcribeFile(clip, p, { allowEmpty: true });
      billedSeconds += Math.max(seconds, MIN_BILLED_SECONDS);
      // Whisper's segments can overlap: one kept beside the window may already hold the words
      const inside = (s: Segment, t: { start: number; end: number }) => mid(s) > t.start && mid(s) < t.end;
      const heard = clean(raw, start, rules).filter((s) => inside(s, w) && !neighbours.some((n) => inside(s, n)));
      // Without a prompt there is nothing to read back, so a list of the prompt's companies
      // that comes back then is what was said
      const segs = heard.filter((s) => !suspectReason(s, p));
      return { heard, segs, chars: sum(segs.map((s) => realChars(s, p))) };
    };
    const enough = MIN_CHARS_PER_SECOND * (w.end - w.start);
    let best = await pass(prompt);
    let bare: Awaited<ReturnType<typeof pass>> | undefined;
    if (best.chars < enough && prompt) {
      bare = await pass(undefined);
      // Without a prompt Whisper also invents text over music (字幕志願者…, 優優獨播劇場…),
      // one line where speech would fill the window, so it counts only when it heard speech
      // throughout
      if (bare.chars >= enough && bare.chars > best.chars) best = bare;
    }
    const original = sum(w.original.map((s) => realChars(s, judge)));
    if (best.chars > original) return { segments: best.segs, billedSeconds };
    const invented = w.original.length > 0 && w.original.every((s) => isInvented(s, judge));
    if (invented && original < MIN_KEPT_CHARS && !heardAgain(w.original, bare?.heard ?? [])) return { segments: [], billedSeconds };
    return { segments: w.original, billedSeconds };
  } finally {
    fs.rmSync(clip, { force: true });
  }
}

function isInvented(s: Segment, prompt: string | undefined): boolean {
  const reason = suspectReason(s, prompt);
  return reason === 'known' || reason === 'echo';
}

// Whether a pass without the prompt heard the original's words: then they were said (the
// host can read out a headline that starts like an outro), not read back or invented
function heardAgain(original: Segment[], heard: Segment[]): boolean {
  const said = compact(heard.map((s) => s.text).join(''));
  return original.every((s) => {
    const words = compact(s.text);
    return words.length >= 2 && said.includes(words);
  });
}

export type SuspectReason = 'known' | 'echo' | 'sparse';

// Why a segment looks invented rather than heard, if it does
export function suspectReason(s: Segment, prompt: string | undefined): SuspectReason | null {
  if (HALLUCINATIONS.some((re) => re.test(s.text))) return 'known';
  if (prompt) {
    const echo = echoChars(s.text, prompt);
    if (echo >= ECHO_MIN_CHARS && echo >= ECHO_MIN_SHARE * compact(s.text).length) return 'echo';
  }
  const seconds = s.end - s.start;
  if (seconds >= SPARSE_MIN_SECONDS && compact(s.text).length / seconds < MIN_CHARS_PER_SECOND) return 'sparse';
  return null;
}

export function findSuspects(segs: Segment[], prompt: string | undefined): Segment[] {
  return segs.filter((s) => suspectReason(s, prompt));
}

// Characters of a segment that are neither a known hallucination nor the prompt read back.
// Only an echo loses its runs of the prompt: the real 歡迎收聽股癌，我是謝孟恭 is all runs.
export function realChars(s: Segment, prompt: string | undefined): number {
  const length = compact(s.text).length;
  const reason = suspectReason(s, prompt);
  if (reason === 'known') return length <= KNOWN_MAX_CHARS ? 0 : length;
  if (reason === 'echo') return Math.max(0, length - echoChars(s.text, prompt!));
  return length;
}

// How many characters of text lie in distinct runs of ECHO_MIN_RUN+ that appear in the
// prompt, punctuation, spaces and case ignored. Whisper reads the prompt back shuffled
// (今天聊聊台股、美股，還有通膨、殖利率、NVIDIA、特斯拉), so runs, not one long match; and
// distinct, since a sentence naming Google twice reads nothing back.
export function echoChars(text: string, prompt: string): number {
  const t = compact(text);
  const p = compact(prompt);
  const runs = new Set<string>();
  for (let i = 0; i < t.length; ) {
    let len = 0;
    while (i + len < t.length && p.includes(t.slice(i, i + len + 1))) len++;
    if (len >= ECHO_MIN_RUN) {
      runs.add(t.slice(i, i + len));
      i += len;
    } else i++;
  }
  return sum([...runs].map((r) => r.length));
}

function compact(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

function sum(ns: number[]): number {
  return ns.reduce((a, n) => a + n, 0);
}

function clean(raw: GroqSegment[], offset: number, rules: [string, string][]): Segment[] {
  const out: Segment[] = [];
  for (const s of raw) {
    if (isSilence(s)) continue;
    const text = normalizeText(s.text, rules);
    if (text) out.push({ start: s.start + offset, end: s.end + offset, text });
  }
  return out;
}

// Spans of at least minGap seconds with no segment, including the start and end
export function findGaps(segs: Segment[], duration: number, minGap = MIN_GAP_SECONDS): { start: number; end: number }[] {
  const gaps: { start: number; end: number }[] = [];
  let covered = 0;
  for (const s of segs) {
    if (s.start - covered >= minGap) gaps.push({ start: covered, end: s.start });
    covered = Math.max(covered, s.end);
  }
  if (duration - covered >= minGap) gaps.push({ start: covered, end: duration });
  return gaps;
}

async function transcribeFile(file: string, prompt: string | undefined, opts: { allowEmpty?: boolean } = {}): Promise<GroqSegment[]> {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(file)], { type: 'audio/mpeg' }), path.basename(file));
  form.append('model', 'whisper-large-v3');
  form.append('response_format', 'verbose_json');
  form.append('language', 'zh');
  form.append('temperature', '0');
  if (prompt) form.append('prompt', prompt);

  const res = await postWithRateLimit(form);
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { segments?: GroqSegment[] };
  if (!body.segments?.length && !opts.allowEmpty) throw new Error('Groq returned no segments');
  return body.segments ?? [];
}

// Whisper invents text over silence and music beds. no_speech_prob alone is unreliable:
// on EP709 it went above 0.9 for whole 30s windows of clear speech, so like Whisper's
// own decoder, only drop a window that is also low-confidence.
export function isSilence(s: GroqSegment): boolean {
  return (s.no_speech_prob ?? 0) > 0.6 && (s.avg_logprob ?? 0) < -1;
}

// The free tier allows 7200 audio-seconds per hour, so seeding several episodes or
// re-running one hits 429. Wait as long as Groq asks instead of failing the episode.
const MAX_RATE_LIMIT_WAITS = 6;
const MAX_WAIT_MS = 30 * 60_000;

async function postWithRateLimit(form: FormData): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${requireEnv('GROQ_API_KEY')}` },
      body: form,
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (res.status !== 429 || attempt >= MAX_RATE_LIMIT_WAITS) return res;
    const waitMs = Math.min(retryAfterMs(res.headers.get('retry-after'), await res.text()), MAX_WAIT_MS);
    console.log(`Groq rate limit; waiting ${Math.ceil(waitMs / 60_000)} min`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

// Groq sends retry-after in seconds and repeats it in the message ("try again in 8m15.5s")
export function retryAfterMs(header: string | null, body: string): number {
  const secs = Number(header);
  if (header && Number.isFinite(secs)) return (secs + 5) * 1000;
  const m = /try again in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/.exec(body);
  if (m && (m[1] || m[2] || m[3])) return ((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0) + 5) * 1000;
  return 60_000;
}

// Whisper sometimes repeats one line for minutes; keep the first two in a run.
export function dropLoops(segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  let run = 0;
  for (const s of segs) {
    run = out.length && out[out.length - 1]!.text === s.text ? run + 1 : 0;
    if (run < 2) out.push(s);
  }
  return out;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
