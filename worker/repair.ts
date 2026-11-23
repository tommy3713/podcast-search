import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '@/lib/db.ts';
import type { Segment } from '@/lib/segments.ts';
import { enqueue, queueState } from './actions.ts';
import { compress, download } from './audio.ts';
import { chunkSegments } from './chunk.ts';
import { WORK_DIR, whisperCost } from './config.ts';
import { embed } from './embed.ts';
import { notify } from './notify.ts';
import { usd } from './pipeline.ts';
import {
  appliedEdits,
  deleteState,
  episodesToRepair,
  getEpisode,
  getState,
  promptText,
  repairDue,
  saveRepair,
  setState,
  skipRepair,
  transcriptionSettings,
} from './repo.ts';
import { isReleaseHours, taipeiTime } from './schedule.ts';
import { describeRepair, planWindows, repairTranscript } from './transcribe.ts';

// A one-off repair of the transcripts made before suspect segments were handled
// (transcribe.ts): Whisper fails some 30 s windows of clear speech, writing one invented
// sentence across them, and 695 of 715 live episodes had such segments. New episodes are
// repaired as they are transcribed; this goes through the live ones once, newest first,
// started from Telegram (/repair) like a backfill: each episode is its own queue job (download,
// re-transcribe its windows, swap the transcript in) with a pause before the next, the plan is
// kept in worker_state so a restart carries on, and an episode repaired gets a
// transcript_repairs row, so it isn't planned again.
const STATE_KEY = 'repair';
export const PAUSE_MS = 2 * 60_000;
// How often a run waiting out a release day looks again
export const RELEASE_WAIT_MS = 10 * 60_000;
// Two failures in a row (a used-up Groq quota, an outage) stop it instead of paying on
export const STOP_AFTER_FAILURES = 2;
// Groq bills at least this much per request (transcribe.ts)
const MIN_BILLED_SECONDS = 10;
// The audio downloaded today must be the one the transcript was made from: re-uploaded with
// another length (an ad added), its spans would be cut at the wrong times
const MAX_DURATION_DRIFT_SECONDS = 2;
const EMBED_USD_PER_EPISODE = 0.0005;

// `episodes` newest first; `next` is the index of the one to do next; `id` tells one run from
// another; the rest add up what this run did and paid
export type RepairRun = {
  id: number;
  episodes: number[];
  next: number;
  failures: number;
  failed: number[];
  // Left out: the audio's length no longer matches the transcript's
  skipped: number[];
  changed: number;
  recovered: number;
  dropped: number;
  spent: number;
};

const span = (nos: number[]) => (nos.length === 1 ? `EP${nos[0]}` : `EP${nos[0]}–${nos.at(-1)}`);

export function getRepair(db: DB): RepairRun | null {
  const v = getState(db, STATE_KEY);
  return v ? (JSON.parse(v) as RepairRun) : null;
}

const save = (db: DB, r: RepairRun) => setState(db, STATE_KEY, JSON.stringify(r));

// main.ts restarts the seek indexer, which waits while a repair is under way, when one ends
let onEnd: (() => void) | null = null;
export function onRepairEnd(fn: (() => void) | null): void {
  onEnd = fn;
}

// An admin's applied corrections are never suspect: words they wrote may be few over a long span
export function editedSegments(db: DB, episodeId: number): (s: Segment) => boolean {
  const edited = new Set(appliedEdits(db, episodeId).map((e) => `${e.segStart}|${e.newText}`));
  return (s) => edited.has(`${s.start}|${s.text}`);
}

export type RepairPlan = { episodes: { no: number; windows: number }[]; windows: number; cost: number };

// The n newest live episodes (all when n is undefined) not repaired yet that have a span to
// transcribe again, or why there are none. The cost is an upper bound: two passes per window.
export function planRepair(db: DB, n?: number): RepairPlan | string {
  const episodes: RepairPlan['episodes'] = [];
  let seconds = 0;
  for (const e of episodesToRepair(db)) {
    const segs = JSON.parse(e.segments_json) as Segment[];
    const windows = planWindows(segs, e.duration ?? segs.at(-1)?.end ?? 0, promptText(db, e.whisper_prompt_id), editedSegments(db, e.id));
    if (!windows.length) continue;
    episodes.push({ no: e.episode_no, windows: windows.length });
    seconds += windows.reduce((s, w) => s + Math.max(w.end - w.start + 2, MIN_BILLED_SECONDS), 0);
    if (n !== undefined && episodes.length >= n) break;
  }
  if (!episodes.length) return '沒有需要修補的集數';
  const windows = episodes.reduce((s, e) => s + e.windows, 0);
  return { episodes, windows, cost: whisperCost(2 * seconds) + episodes.length * EMBED_USD_PER_EPISODE };
}

export function describePlan(p: RepairPlan): string {
  const nos = p.episodes.map((e) => e.no);
  return `將修補 ${span(nos)} 中 ${nos.length} 集的逐字稿（共 ${p.windows} 處要重轉），預估最多 ${usd(p.cost)}`;
}

export function startRepair(db: DB, plan: RepairPlan): RepairRun {
  const r: RepairRun = {
    id: Date.now(),
    episodes: plan.episodes.map((e) => e.no),
    next: 0,
    failures: 0,
    failed: [],
    skipped: [],
    changed: 0,
    recovered: 0,
    dropped: 0,
    spent: 0,
  };
  save(db, r);
  return r;
}

export type EpisodeRepair = { changed: boolean; recovered: number; dropped: number; costUsd: number; summary: string; skipped?: string };

const nothing = (summary: string, skipped?: string): EpisodeRepair => ({ changed: false, recovered: 0, dropped: 0, costUsd: 0, summary, skipped });

// Downloads the episode, transcribes its windows again (repairTranscript: its segments judged
// by the prompt they were made with, the passes given today's prompt and rules, an admin's
// corrections left alone) and saves the result: the new transcript re-chunked and re-embedded
// when it changed (about US$0.0005), and the transcript_repairs row either way. The summary is
// left as it is. An episode repaired already (a restart right after its save) is passed over,
// and one whose audio no longer matches is left out (`skipped`).
export async function repairEpisode(db: DB, episodeNo: number): Promise<EpisodeRepair> {
  const ep = getEpisode(db, episodeNo);
  if (ep?.status !== 'done' || !ep.segments_json) throw new Error(`EP${episodeNo} 不在網站上`);
  if (!repairDue(db, ep.id)) return nothing(`EP${episodeNo}: repaired already`);
  const readJson = ep.segments_json;
  const row = db.prepare('SELECT whisper_prompt_id FROM episodes WHERE id = ?').get(ep.id) as { whisper_prompt_id: number | null };
  const dir = path.join(WORK_DIR, `repair${episodeNo}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  try {
    const original = path.join(dir, 'original.mp3');
    await download(ep.audio_url, original);
    // Re-encoded at a constant bitrate as for transcribing: cut from SoundOn's VBR file, a clip
    // would start where its Xing table of contents says, seconds off (see seek.ts)
    const { parts, duration } = await compress(original, dir);
    if (ep.duration !== null && Math.abs(duration - ep.duration) > MAX_DURATION_DRIFT_SECONDS) {
      skipRepair(db, ep.id);
      const why = `音檔長度和逐字稿不符（${Math.round(duration)} 秒，逐字稿是 ${ep.duration} 秒），可能重新上傳過`;
      console.log(`EP${episodeNo}: repair skipped, ${why}`);
      return nothing(`EP${episodeNo}: skipped`, why);
    }
    const r = await repairTranscript(parts, JSON.parse(readJson) as Segment[], {
      ...transcriptionSettings(db),
      judgePrompt: promptText(db, row.whisper_prompt_id),
      keep: editedSegments(db, ep.id),
    });
    const changed = r.changes.some((c) => c.outcome !== 'kept');
    const chunks = changed ? chunkSegments(r.segments) : [];
    const { vectors, costUsd: embedUsd } = changed ? await embed(chunks.map((c) => c.text)) : { vectors: [], costUsd: 0 };
    const costUsd = whisperCost(r.billedSeconds) + embedUsd;
    saveRepair(db, ep.id, { readJson, segments: changed ? r.segments : null, chunks, vectors, costUsd, windows: r.windows, changes: r.changes });
    const count = (o: string) => r.changes.filter((c) => c.outcome === o).length;
    const summary = `EP${episodeNo}: ${describeRepair(r)}, ${usd(costUsd)}`;
    console.log(summary);
    return { changed, recovered: count('recovered'), dropped: count('dropped'), costUsd, summary };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function finish(db: DB, r: RepairRun, title: string): Promise<false> {
  deleteState(db, STATE_KEY);
  onEnd?.();
  await notify(formatProgress(r, title));
  return false;
}

// Repairs the next episode of the run. False once there is no run left: finished, stopped
// after repeated failures, or cancelled with /repair stop.
export async function repairStep(db: DB): Promise<boolean> {
  const r = getRepair(db);
  if (!r) return false;
  const no = r.episodes[r.next];
  if (no === undefined) return finish(db, r, '🩹 逐字稿修補完成');
  let done: EpisodeRepair | null = null;
  let error = '';
  try {
    done = await repairEpisode(db, no);
  } catch (err) {
    console.error(`[repair] EP${no}`, err);
    error = err instanceof Error ? err.message : String(err);
  }
  const now = getRepair(db);
  // Cancelled, or replaced by a new run while this episode ran
  if (now?.id !== r.id) return now !== null;
  const failures = done ? 0 : now.failures + 1;
  const updated: RepairRun = {
    ...now,
    next: now.next + 1,
    failures,
    failed: done ? now.failed : [...now.failed, no],
    skipped: done?.skipped ? [...now.skipped, no] : now.skipped,
    changed: now.changed + (done?.changed ? 1 : 0),
    recovered: now.recovered + (done?.recovered ?? 0),
    dropped: now.dropped + (done?.dropped ?? 0),
    spent: now.spent + (done?.costUsd ?? 0),
  };
  if (!done) await notify(`⚠️ EP${no} 逐字稿修補失敗：${error}`.slice(0, 400));
  if (done?.skipped) await notify(`⚠️ EP${no} 逐字稿修補跳過：${done.skipped}`);
  if (failures >= STOP_AFTER_FAILURES) return finish(db, updated, `⏸ 逐字稿修補停止：連續 ${failures} 集失敗`);
  if (updated.next >= updated.episodes.length) return finish(db, updated, '🩹 逐字稿修補完成');
  save(db, updated);
  return true;
}

// Ends the run after the episode in progress, if any; returns its progress so far
export function cancelRepair(db: DB): string | null {
  const r = getRepair(db);
  if (!r) return null;
  deleteState(db, STATE_KEY);
  onEnd?.();
  const busy = queueState().running?.startsWith('修補逐字稿 EP');
  return formatProgress(r, busy ? '⏹ 逐字稿修補已停止（處理中的那集會做完）' : '⏹ 逐字稿修補已停止');
}

export function formatProgress(r: RepairRun, title: string): string {
  const done = r.next - r.failed.length - r.skipped.length;
  const left = r.episodes.length - r.next;
  const lines = [
    `${title}：${span(r.episodes)}`,
    `修了 ${done} 集（逐字稿有改的 ${r.changed} 集，救回 ${r.recovered} 處、刪掉 ${r.dropped} 處）${r.failed.length ? `・失敗 ${r.failed.length} 集` : ''}${r.skipped.length ? `・跳過 ${r.skipped.length} 集` : ''}${left > 0 ? `・還沒修 ${left} 集` : ''}・這次花了 ${usd(r.spent)}`,
  ];
  if (r.failed.length) {
    const list = r.failed.slice(0, 10).map((n) => `EP${n}`);
    lines.push(`失敗：${list.join('、')}${r.failed.length > 10 ? ' 等' : ''}（下次 /repair 會再排進去）`);
  }
  if (r.skipped.length) lines.push(`跳過（音檔和逐字稿長度不符）：${r.skipped.map((n) => `EP${n}`).join('、')}`);
  return lines.join('\n');
}

export function repairStatus(db: DB): string {
  const r = getRepair(db);
  if (r) return formatProgress(r, '🩹 逐字稿修補中');
  return '目前沒有在修補逐字稿';
}

let running = false;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Runs the repair in the database, if any, until it is over; does nothing if already running.
// Called when a run is confirmed, by /repair (resuming one an error interrupted) and when the
// worker starts. Release days' polling hours are waited out, so a new episode gets the Groq
// quota.
export function runRepair(db: DB, opts: { pauseMs?: number; releaseWaitMs?: number; now?: () => Date } = {}): Promise<void> {
  if (running || !getRepair(db)) return Promise.resolve();
  running = true;
  const now = opts.now ?? (() => new Date());
  return (async () => {
    try {
      for (;;) {
        const r = getRepair(db);
        if (!r) break;
        if (isReleaseHours(taipeiTime(now()))) {
          await sleep(opts.releaseWaitMs ?? RELEASE_WAIT_MS);
          continue;
        }
        const no = r.episodes[r.next];
        if (!(await enqueue(no === undefined ? '逐字稿修補收尾' : `修補逐字稿 EP${no}`, () => repairStep(db)))) break;
        await sleep(opts.pauseMs ?? PAUSE_MS);
      }
    } catch (err) {
      // Kept in worker_state: the next start picks it up again
      console.error('[repair]', err);
      await notify(`❌ 逐字稿修補中斷：${err instanceof Error ? err.message : String(err)}`.slice(0, 500) + '\n/repair 或重啟 worker 會接著修');
    } finally {
      running = false;
    }
  })();
}
