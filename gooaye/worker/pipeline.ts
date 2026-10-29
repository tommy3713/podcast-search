import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '@/lib/db.ts';
import type { Segment } from '@/lib/segments.ts';
import { compress, download } from './audio.ts';
import { chunkSegments } from './chunk.ts';
import { MAX_RETRIES, WORK_DIR, whisperCost } from './config.ts';
import { embed } from './embed.ts';
import { notify } from './notify.ts';
import { type EpisodeRow, markFailed, publishEpisode, saveSegments, setStatus } from './repo.ts';
import { summarize } from './summarize.ts';
import { transcribe } from './transcribe.ts';

export type ProcessOptions = {
  // Dev only: use these segments instead of downloading and transcribing
  segments?: Segment[];
};

export async function processEpisode(db: DB, ep: EpisodeRow, opts: ProcessOptions = {}): Promise<boolean> {
  const label = `EP${ep.episode_no}`;
  const started = Date.now();
  try {
    let segments: Segment[];
    let duration: number;
    if (opts.segments) {
      segments = opts.segments;
      duration = segments.at(-1)?.end ?? 0;
      saveSegments(db, ep.id, segments, duration, 0);
    } else if (ep.segments_json) {
      segments = JSON.parse(ep.segments_json) as Segment[];
      duration = ep.duration ?? segments.at(-1)?.end ?? 0;
      console.log(`${label}: reusing saved transcript (${segments.length} segments)`);
    } else {
      setStatus(db, ep.id, 'transcribing');
      ({ segments, duration } = await transcribeFromRss(ep));
      saveSegments(db, ep.id, segments, duration, whisperCost(duration));
    }

    setStatus(db, ep.id, 'summarizing');
    console.log(`${label}: summarizing ${segments.length} segments`);
    const { summary, costUsd: summaryCost } = await summarize(ep.episode_no, segments, duration);
    const chunks = chunkSegments(segments);
    console.log(`${label}: embedding ${chunks.length} chunks`);
    const { vectors, costUsd: embedCost } = await embed(chunks.map((c) => c.text));

    const total = publishEpisode(db, ep.id, { summary, chunks, vectors, costUsd: summaryCost + embedCost });
    const mins = Math.round((Date.now() - started) / 60_000);
    await notify(
      `✅ ${label} ${ep.title} 上線\n` +
        `${summary.chapters.length} 章・${summary.stocks.length} 檔股票・${summary.mentions.length} 則提及・${chunks.length} 段\n` +
        `費用 US$${total.toFixed(3)}・耗時 ${mins} 分` +
        (process.env.SITE_URL ? `\n${process.env.SITE_URL}/ep/${ep.episode_no}` : ''),
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const retries = markFailed(db, ep.id, msg);
    console.error(`${label} failed (${retries}/${MAX_RETRIES}):`, err instanceof Error ? (err.stack ?? msg) : msg);
    await notify(
      `❌ ${label} 處理失敗（第 ${retries}/${MAX_RETRIES} 次）\n${msg.slice(0, 500)}` +
        (retries >= MAX_RETRIES ? '\n已停止重試，修好後執行 worker ingest ' + ep.episode_no : ''),
    );
    return false;
  }
}

async function transcribeFromRss(ep: EpisodeRow): Promise<{ segments: Segment[]; duration: number }> {
  const dir = path.join(WORK_DIR, `ep${ep.episode_no}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  try {
    const original = path.join(dir, 'original.mp3');
    console.log(`EP${ep.episode_no}: downloading`);
    await download(ep.audio_url, original);
    const { parts, duration } = await compress(original, dir);
    console.log(`EP${ep.episode_no}: transcribing ${Math.round(duration / 60)} min in ${parts.length} part(s)`);
    const segments = await transcribe(parts);
    return { segments, duration };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
