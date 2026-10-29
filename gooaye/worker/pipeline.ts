import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '@/lib/db.ts';
import type { Segment } from '@/lib/segments.ts';
import type { Summary } from '@/lib/summary.ts';
import { compress, download } from './audio.ts';
import { chunkSegments } from './chunk.ts';
import { estimateCost, MAX_RETRIES, WORK_DIR, whisperCost } from './config.ts';
import { embed } from './embed.ts';
import { notify } from './notify.ts';
import {
  type EpisodeRow,
  markFailed,
  publishEpisode,
  recordError,
  saveDraft,
  saveSegments,
  setStatus,
  type Step,
} from './repo.ts';
import { summarize } from './summarize.ts';
import type { Button } from './telegram.ts';
import { transcribe } from './transcribe.ts';

export type ProcessOptions = {
  // Default: resume from the saved checkpoints (transcript, summary draft).
  // 'transcribe' redoes everything; 'summarize' keeps the transcript.
  redoFrom?: 'transcribe' | 'summarize';
  // Dev only: use these segments instead of downloading and transcribing
  segments?: Segment[];
};

export const STEP_LABEL: Record<Step, string> = { transcribe: '轉錄', summarize: '整理重點', embed: '建立索引' };

const usd = (n: number) => `US$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`;

// Buttons offered after a run. callback data is "<action>:<episode>"
export function retryButtons(ep: { episode_no: number; duration: number | null }, failedStep: Step | null): Button[][] {
  const d = ep.duration ?? 3000;
  const rows: Button[][] = [];
  if (failedStep && failedStep !== 'transcribe') {
    rows.push([{ text: `🔁 從「${STEP_LABEL[failedStep]}」重試 ~${usd(estimateCost(failedStep, d))}`, data: `retry:${ep.episode_no}` }]);
  }
  if (failedStep !== 'embed') {
    rows.push([{ text: `📝 重新整理重點 ~${usd(estimateCost('summarize', d))}`, data: `resummarize:${ep.episode_no}` }]);
  }
  rows.push([{ text: `🎙 重新轉錄 ~${usd(estimateCost('transcribe', d))}`, data: `retranscribe:${ep.episode_no}` }]);
  return rows;
}

export async function processEpisode(db: DB, ep: EpisodeRow, opts: ProcessOptions = {}): Promise<boolean> {
  const label = `EP${ep.episode_no}`;
  const started = Date.now();
  // Re-running a live episode leaves it visible until the new version is published
  const live = ep.status === 'done';
  const progress = (status: 'transcribing' | 'summarizing') => !live && setStatus(db, ep.id, status);
  let step: Step = 'transcribe';
  try {
    // ① transcript
    let segments: Segment[];
    let duration: number;
    if (opts.segments) {
      segments = opts.segments;
      duration = segments.at(-1)?.end ?? 0;
      saveSegments(db, ep.id, segments, duration, 0);
    } else if (ep.segments_json && opts.redoFrom !== 'transcribe') {
      segments = JSON.parse(ep.segments_json) as Segment[];
      duration = ep.duration ?? segments.at(-1)?.end ?? 0;
      console.log(`${label}: reusing saved transcript (${segments.length} segments)`);
    } else {
      progress('transcribing');
      let billedSeconds: number;
      ({ segments, duration, billedSeconds } = await transcribeFromRss(ep));
      saveSegments(db, ep.id, segments, duration, whisperCost(billedSeconds));
    }

    // ② summary
    step = 'summarize';
    let summary: Summary;
    if (ep.summary_draft_json && !opts.redoFrom && !opts.segments) {
      summary = JSON.parse(ep.summary_draft_json) as Summary;
      console.log(`${label}: reusing saved summary draft`);
    } else {
      progress('summarizing');
      console.log(`${label}: summarizing ${segments.length} segments`);
      const res = await summarize(ep.episode_no, segments, duration);
      summary = res.summary;
      saveDraft(db, ep.id, summary, res.costUsd);
    }

    // ③ chunks, embeddings, publish
    step = 'embed';
    const chunks = chunkSegments(segments);
    console.log(`${label}: embedding ${chunks.length} chunks`);
    const { vectors, costUsd } = await embed(chunks.map((c) => c.text));
    const total = publishEpisode(db, ep.id, { summary, chunks, vectors, costUsd });

    const mins = Math.max(1, Math.round((Date.now() - started) / 60_000));
    await notify(
      `✅ ${label} ${ep.title} ${live ? '已更新' : '上線'}\n` +
        `${summary.chapters.length} 章・${summary.stocks.length} 檔股票・${summary.mentions.length} 則提及・${chunks.length} 段\n` +
        `這集累計費用 ${usd(total)}・耗時 ${mins} 分` +
        (process.env.SITE_URL ? `\n${process.env.SITE_URL}/ep/${ep.episode_no}` : ''),
      [[{ text: `📝 重新整理重點 ~${usd(estimateCost('summarize', duration))}`, data: `resummarize:${ep.episode_no}` }]],
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const where = `「${STEP_LABEL[step]}」`;
    const kept = step === 'transcribe' ? '' : step === 'summarize' ? '\n逐字稿已保存，重試不會再付轉錄費' : '\n逐字稿和重點已保存，重試只會重建索引';
    console.error(`${label} failed at ${step}:`, err instanceof Error ? (err.stack ?? msg) : msg);
    const buttons = retryButtons(ep, step);
    if (live) {
      recordError(db, ep.id, msg, step);
      await notify(`❌ ${label} 重跑失敗：${where}，網站上仍是舊版\n${msg.slice(0, 500)}${kept}`, buttons);
      return false;
    }
    const retries = markFailed(db, ep.id, msg, step);
    const auto = retries < MAX_RETRIES ? '下次排程會自動重試' : '已停止自動重試';
    await notify(`❌ ${label} 處理失敗：${where}（第 ${retries}/${MAX_RETRIES} 次，${auto}）\n${msg.slice(0, 500)}${kept}`, buttons);
    return false;
  }
}

async function transcribeFromRss(ep: EpisodeRow): Promise<{ segments: Segment[]; duration: number; billedSeconds: number }> {
  const dir = path.join(WORK_DIR, `ep${ep.episode_no}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  try {
    const original = path.join(dir, 'original.mp3');
    console.log(`EP${ep.episode_no}: downloading`);
    await download(ep.audio_url, original);
    const { parts, duration } = await compress(original, dir);
    console.log(`EP${ep.episode_no}: transcribing ${Math.round(duration / 60)} min in ${parts.length} part(s)`);
    const { segments, billedSeconds } = await transcribe(parts);
    return { segments, duration, billedSeconds };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
