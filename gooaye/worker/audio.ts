import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { USER_AGENT } from './config.ts';

// Groq's direct-upload limit is 25MB. Mono 16kHz 32kbps is ~14MB/hour, so only
// unusually long episodes get split.
const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;
const PART_SECONDS = 50 * 60;

export async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok || !res.body) throw new Error(`download ${res.status} ${res.statusText}`);
  await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(dest));
  const size = fs.statSync(dest).size;
  if (size < 1024 * 1024) throw new Error(`downloaded audio is only ${size} bytes`);
}

export type AudioPart = { file: string; offset: number; duration: number };

// Returns the compressed audio, split into parts with their start offsets if needed.
export async function compress(input: string, workDir: string): Promise<{ parts: AudioPart[]; duration: number }> {
  const out = path.join(workDir, 'audio.mp3');
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', out]);
  const duration = await probeDuration(out);
  if (fs.statSync(out).size <= MAX_UPLOAD_BYTES) return { parts: [{ file: out, offset: 0, duration }], duration };

  const parts: AudioPart[] = [];
  for (let offset = 0, i = 0; offset < duration; offset += PART_SECONDS, i++) {
    const file = path.join(workDir, `part${i}.mp3`);
    await cutClip(out, offset, PART_SECONDS, file);
    parts.push({ file, offset, duration: Math.min(PART_SECONDS, duration - offset) });
  }
  return { parts, duration };
}

export async function cutClip(input: string, start: number, seconds: number, out: string): Promise<void> {
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(start), '-t', String(seconds), '-i', input, '-c', 'copy', out]);
}

async function probeDuration(file: string): Promise<number> {
  const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  const d = Number(out.trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error(`ffprobe could not read duration of ${file}`);
  return d;
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(stdout) : reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-500)}`))));
  });
}
