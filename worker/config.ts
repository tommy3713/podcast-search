import os from 'node:os';
import path from 'node:path';

export { llmCost } from '@/lib/cost.ts';

export const RSS_URL = 'https://feeds.soundon.fm/podcasts/954689a5-3096-43a4-a80b-7810b219cef3.xml';
// SoundOn returns 403 without a browser-like User-Agent
export const USER_AGENT = 'Mozilla/5.0 (compatible; gooaye-worker/1.0)';

export const MAX_RETRIES = 3;
export const SUMMARY_MODEL = process.env.SUMMARY_MODEL ?? 'gpt-5.5';
export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const WORK_DIR = process.env.WORK_DIR ?? path.join(os.tmpdir(), 'gooaye-worker');

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

// USD. Token prices live in src/lib/cost.ts, shared with the web's Q&A.
const GROQ_WHISPER_PER_HOUR = 0.111;

export function whisperCost(billedSeconds: number): number {
  return (billedSeconds / 3600) * GROQ_WHISPER_PER_HOUR;
}

// Rough per-minute cost of the summary call, from EP709 (52 min, US$0.30 on gpt-5.5).
// Only used to label retry buttons.
const SUMMARY_USD_PER_MINUTE = 0.006;

export function estimateCost(step: 'transcribe' | 'summarize' | 'embed', durationSec: number): number {
  const summary = (durationSec / 60) * SUMMARY_USD_PER_MINUTE;
  if (step === 'transcribe') return whisperCost(durationSec) + summary;
  if (step === 'summarize') return summary;
  return 0.001;
}
