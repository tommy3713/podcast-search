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

// Returns segments with episode-relative times, plus the audio seconds Groq will bill.
export async function transcribe(parts: AudioPart[]): Promise<{ segments: Segment[]; billedSeconds: number }> {
  const all: Segment[] = [];
  let billedSeconds = 0;
  for (const part of parts) {
    const segs = clean(await transcribeFile(part.file), 0);
    billedSeconds += Math.max(part.duration, MIN_BILLED_SECONDS);

    // Sent as one long file, Whisper sometimes returns nothing for whole 30s windows of
    // clear speech (EP709 lost 14 of them). Those spans transcribe fine on their own.
    for (const gap of findGaps(segs, part.duration)) {
      const start = Math.max(0, gap.start - 1);
      const seconds = gap.end + 1 - start;
      const clip = `${part.file}.gap${Math.round(start)}.mp3`;
      await cutClip(part.file, start, seconds, clip);
      const fill = clean(await transcribeFile(clip, { allowEmpty: true }), start);
      fs.rmSync(clip, { force: true });
      billedSeconds += Math.max(seconds, MIN_BILLED_SECONDS);
      const mid = (s: Segment) => (s.start + s.end) / 2;
      segs.push(...fill.filter((s) => mid(s) > gap.start && mid(s) < gap.end));
    }

    segs.sort((a, b) => a.start - b.start);
    all.push(...segs.map((s) => ({ ...s, start: round1(s.start + part.offset), end: round1(s.end + part.offset) })));
  }
  return { segments: dropLoops(all), billedSeconds };
}

function clean(raw: GroqSegment[], offset: number): Segment[] {
  const out: Segment[] = [];
  for (const s of raw) {
    if (isSilence(s)) continue;
    const text = normalizeText(s.text);
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

async function transcribeFile(file: string, opts: { allowEmpty?: boolean } = {}): Promise<GroqSegment[]> {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(file)], { type: 'audio/mpeg' }), path.basename(file));
  form.append('model', 'whisper-large-v3');
  form.append('response_format', 'verbose_json');
  form.append('language', 'zh');
  form.append('temperature', '0');
  form.append('prompt', WHISPER_PROMPT);

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
