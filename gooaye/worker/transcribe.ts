import fs from 'node:fs';
import path from 'node:path';
import type { Segment } from '@/lib/segments.ts';
import type { AudioPart } from './audio.ts';
import { requireEnv } from './config.ts';
import { normalizeText, WHISPER_PROMPT } from './text.ts';

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

type GroqSegment = { start: number; end: number; text: string; no_speech_prob?: number };

export async function transcribe(parts: AudioPart[]): Promise<Segment[]> {
  const all: Segment[] = [];
  for (const part of parts) {
    for (const s of await transcribePart(part.file)) {
      // Whisper invents text over silence and music beds
      if ((s.no_speech_prob ?? 0) > 0.9) continue;
      const text = normalizeText(s.text);
      if (!text) continue;
      all.push({ start: round1(s.start + part.offset), end: round1(s.end + part.offset), text });
    }
  }
  return dropLoops(all);
}

async function transcribePart(file: string): Promise<GroqSegment[]> {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(file)], { type: 'audio/mpeg' }), path.basename(file));
  form.append('model', 'whisper-large-v3');
  form.append('response_format', 'verbose_json');
  form.append('language', 'zh');
  form.append('temperature', '0');
  form.append('prompt', WHISPER_PROMPT);

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${requireEnv('GROQ_API_KEY')}` },
    body: form,
    signal: AbortSignal.timeout(10 * 60_000),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { segments?: GroqSegment[] };
  if (!body.segments?.length) throw new Error('Groq returned no segments');
  return body.segments;
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
