import os from 'node:os';
import path from 'node:path';

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

// USD. Verify against the providers' pricing pages when changing models.
const PER_M_TOKENS: Record<string, { input: number; cached: number; output: number }> = {
  'gpt-5.5': { input: 5, cached: 0.5, output: 30 },
  'gpt-5.4': { input: 2.5, cached: 0.25, output: 15 },
  'gpt-5.4-mini': { input: 0.75, cached: 0.075, output: 4.5 },
  'text-embedding-3-small': { input: 0.02, cached: 0.02, output: 0 },
};
const GROQ_WHISPER_PER_HOUR = 0.111;

export function llmCost(model: string, input: number, cached: number, output: number): number {
  const p = PER_M_TOKENS[model];
  if (!p) return 0;
  return ((input - cached) * p.input + cached * p.cached + output * p.output) / 1e6;
}

export function whisperCost(seconds: number): number {
  // Groq bills at least 10 seconds per request
  return (Math.max(seconds, 10) / 3600) * GROQ_WHISPER_PER_HOUR;
}
