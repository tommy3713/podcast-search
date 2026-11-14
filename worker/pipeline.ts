import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '@/lib/db.ts';
import { NO_SEEK_TABLE, type SeekTable } from '@/lib/seek.ts';
import type { Segment } from '@/lib/segments.ts';
import type { Summary } from '@/lib/summary.ts';
import { compress, download } from './audio.ts';
import { chunkSegments, summaryPoints } from './chunk.ts';
import { estimateCost, MAX_RETRIES, WORK_DIR, whisperCost } from './config.ts';
import { putBackEdits, putBackSummaryEdits } from './edits.ts';
import { embed } from './embed.ts';
import { notify } from './notify.ts';
import {
  type EpisodeRow,
  markFailed,
  publishEpisode,
  recordError,
  saveDraft,
  saveSegments,
  saveSeekTable,
  setStatus,
  type Step,
} from './repo.ts';
import { seekTableOfFile } from './seek-table.ts';
import { summarize } from './summarize.ts';
import type { Button } from './telegram.ts';
import { transcribe } from './transcribe.ts';

export type ProcessOptions = {
  // Default: resume from the saved checkpoints (transcript, summary draft).
  // 'transcribe' redoes everything; 'summarize' keeps the transcript.
  redoFrom?: 'transcribe' | 'summarize';
  // Dev only: use these segments instead of downloading and transcribing
  segments?: Segment[];
  // A backfill's run: no message on success, since the backfill reports once at the end
  quiet?: boolean;
};

export const STEP_LABEL: Record<Step, string> = { transcribe: '轉錄', summarize: '整理重點', embed: '建立索引' };

export const usd = (n: number) => `US$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`;

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
      // A whole new transcript, like a retranscription: an admin's corrections go back in
      const back = putBackEdits(db, ep.id, ep.episode_no, opts.segments);
      segments = back.segments;
      duration = segments.at(-1)?.end ?? 0;
      saveSegments(db, ep.id, segments, duration, 0);
      back.save();
      if (back.message) await notify(back.message);
    } else if (ep.segments_json && opts.redoFrom !== 'transcribe') {
      segments = JSON.parse(ep.segments_json) as Segment[];
      duration = ep.duration ?? segments.at(-1)?.end ?? 0;
      console.log(`${label}: reusing saved transcript (${segments.length} segments)`);
    } else {
      progress('transcribing');
      let billedSeconds: number;
      let seek: SeekTable | null | undefined;
      let fresh: Segment[];
      ({ segments: fresh, duration, billedSeconds, seek } = await transcribeFromRss(ep));
      // An admin's corrections to the old transcript, put back before the summary reads it
      const back = putBackEdits(db, ep.id, ep.episode_no, fresh);
      segments = back.segments;
      saveSegments(db, ep.id, segments, duration, whisperCost(billedSeconds));
      back.save();
      if (back.message) await notify(back.message);
      // The table of the file just transcribed; undefined (unreadable) leaves it to seek-index.ts
      saveSeekTable(db, ep.id, seek === undefined ? null : (seek ?? NO_SEEK_TABLE));
    }

    // ② summary
    step = 'summarize';
    let summary: Summary;
    if (ep.summary_draft_json && !opts.redoFrom && !opts.segments) {
      // An edit applied to the live summary while this draft waited goes into it too
      // (a no-op for the ones already in it: replaceOpen)
      summary = putBackSummaryEdits(db, ep.id, ep.episode_no, JSON.parse(ep.summary_draft_json) as Summary).summary;
      console.log(`${label}: reusing saved summary draft`);
    } else {
      progress('summarizing');
      console.log(`${label}: summarizing ${segments.length} segments`);
      const res = await summarize(ep.episode_no, segments, duration);
      // An admin's corrections to the old summary, where the new one has the same words
      const back = putBackSummaryEdits(db, ep.id, ep.episode_no, res.summary);
      summary = back.summary;
      saveDraft(db, ep.id, summary, res.costUsd);
      if (back.message) await notify(back.message);
    }

    // ③ chunks, embeddings, publish
    step = 'embed';
    const chunks = chunkSegments(segments);
    const points = summaryPoints(summary);
    console.log(`${label}: embedding ${chunks.length} chunks and ${points.length} summary points`);
    const { vectors: all, costUsd } = await embed([...chunks.map((c) => c.text), ...points.map((p) => p.text)]);
    const vectors = all.slice(0, chunks.length);
    const pointVectors = all.slice(chunks.length);
    const total = publishEpisode(db, ep.id, { summary, chunks, vectors, points, pointVectors, costUsd });
    if (opts.quiet) return true;

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
    // Polls don't retry backfilled episodes (workQueue)
    const auto =
      ep.source === 'backfill'
        ? `第 ${retries} 次，下次 /backfill 會重試`
        : `第 ${retries}/${MAX_RETRIES} 次，${retries < MAX_RETRIES ? '下次排程會自動重試' : '已停止自動重試'}`;
    await notify(`❌ ${label} 處理失敗：${where}（${auto}）\n${msg.slice(0, 500)}${kept}`, buttons);
    return false;
  }
}

async function transcribeFromRss(
  ep: EpisodeRow,
): Promise<{ segments: Segment[]; duration: number; billedSeconds: number; seek: SeekTable | null | undefined }> {
  const dir = path.join(WORK_DIR, `ep${ep.episode_no}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  try {
    const original = path.join(dir, 'original.mp3');
    console.log(`EP${ep.episode_no}: downloading`);
    await download(ep.audio_url, original);
    // Never fails the episode: without a table the player just doesn't correct seeks
    const seek = await seekTableOfFile(original).catch((err: unknown) => {
      console.error(`EP${ep.episode_no}: seek table failed`, err);
      return undefined;
    });
    const { parts, duration } = await compress(original, dir);
    console.log(`EP${ep.episode_no}: transcribing ${Math.round(duration / 60)} min in ${parts.length} part(s)`);
    const { segments, billedSeconds } = await transcribe(parts);
    return { segments, duration, billedSeconds, seek };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
