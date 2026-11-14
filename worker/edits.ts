import type { DB } from '@/lib/db.ts';
import type { Segment } from '@/lib/segments.ts';
import { applyEdits, type EditResult } from '@/lib/transcript-edits.ts';
import { chunkSegments } from './chunk.ts';
import { embed } from './embed.ts';
import { notify } from './notify.ts';
import {
  appliedEdits,
  episodesWithPendingEdits,
  failPendingEdits,
  getEpisode,
  pendingEdits,
  recordEditResults,
  reindexEpisode,
} from './repo.ts';

// An admin's transcript edits (src/lib/transcript-edits.ts) are rows the web inserts; this is
// where they reach the transcript. Each episode's are applied as one job on the shared queue,
// so they never race a re-run of the same episode.

export const EDIT_POLL_MS = 15_000;
// After a failed run (the embedding request, say), the episode's edits wait this long, and
// after this many failures in a row they're marked failed, so they stop being retried (and
// the admin page stops reloading for them)
const EDIT_RETRY_MS = 10 * 60_000;
export const EDIT_MAX_FAILURES = 3;

const adminLink = (no: number) => (process.env.SITE_URL ? `\n${process.env.SITE_URL}/admin/ep/${no}` : '');
const counted = (results: EditResult[]) => ({
  done: results.filter((r) => r.outcome !== 'missing').length,
  missing: results.filter((r) => r.outcome === 'missing').length,
});

// Applies an episode's pending edits, re-chunks and re-embeds the whole transcript (about
// US$0.0005; cheaper than working out which chunks moved) and swaps it in; the summary and
// mentions stay as they are. Null when nothing was pending.
export async function applyPendingEdits(db: DB, episodeNo: number): Promise<{ done: number; missing: number } | null> {
  const ep = getEpisode(db, episodeNo);
  if (!ep) return null;
  const edits = pendingEdits(db, ep.id);
  if (!edits.length) return null;
  const label = `EP${episodeNo}`;
  if (ep.status !== 'done' || !ep.segments_json) {
    const n = failPendingEdits(db, ep.id, '這集不在網站上');
    await notify(`❌ ${label} 有 ${n} 處逐字稿修正沒有套用：這集不在網站上`);
    return { done: 0, missing: n };
  }
  const readJson = ep.segments_json;
  const { segments, results } = applyEdits(JSON.parse(readJson) as Segment[], edits);
  const { done, missing } = counted(results);
  const missingLine = missing ? `\n⚠️ ${missing} 處找不到要改的原文，沒有套用` : '';
  if (!results.some((r) => r.outcome === 'exact' || r.outcome === 'nearby')) {
    // Nothing changes in the text, so there's nothing to re-index
    recordEditResults(db, results, '找不到要改的原文');
    await notify(`✏️ ${label} 逐字稿修正：沒有文字需要改${missingLine}${adminLink(episodeNo)}`);
    return { done, missing };
  }
  const chunks = chunkSegments(segments);
  console.log(`${label}: applying ${edits.length} transcript edits, re-embedding ${chunks.length} chunks`);
  const { vectors, costUsd } = await embed(chunks.map((c) => c.text));
  reindexEpisode(db, ep.id, { readJson, segments, chunks, vectors, costUsd, results });
  await notify(`✏️ ${label} 逐字稿修正 ${done} 處，已重新索引（${chunks.length} 段，US$${costUsd.toFixed(4)}）${missingLine}${adminLink(episodeNo)}`);
  return { done, missing };
}

type Enqueue = <T>(label: string, job: () => Promise<T>) => Promise<T>;

// Every EDIT_POLL_MS, queues a job (on the shared queue, `enqueue` from actions.ts, which
// imports the pipeline and so can't be imported here) for each episode with pending edits
// that doesn't have one queued already. Returns a function that stops it.
export function watchEdits(db: DB, enqueue: Enqueue, intervalMs = EDIT_POLL_MS): () => void {
  const queued = new Set<number>();
  const failures = new Map<number, { count: number; retryAt: number }>();
  const check = () => {
    let eps: { id: number; episode_no: number }[];
    try {
      eps = episodesWithPendingEdits(db);
    } catch (err) {
      console.error('[edits]', err instanceof Error ? err.message : err);
      return;
    }
    for (const { id, episode_no: no } of eps) {
      if (queued.has(no) || (failures.get(no)?.retryAt ?? 0) > Date.now()) continue;
      queued.add(no);
      void enqueue(`修正逐字稿 EP${no}`, () => applyPendingEdits(db, no))
        .then(() => failures.delete(no))
        .catch(async (err: unknown) => {
          const msg = (err instanceof Error ? err.message : String(err)).slice(0, 300);
          console.error(`EP${no}: transcript edits failed`, err);
          const count = (failures.get(no)?.count ?? 0) + 1;
          if (count >= EDIT_MAX_FAILURES) {
            failures.delete(no);
            const n = failPendingEdits(db, id, `套用失敗：${msg}`);
            await notify(`❌ EP${no} 逐字稿修正連續失敗 ${count} 次，${n} 處已標為失敗，請到管理頁重新送出：${msg}${adminLink(no)}`);
            return;
          }
          failures.set(no, { count, retryAt: Date.now() + EDIT_RETRY_MS });
          // Reported on the first failure, not every retry
          if (count === 1) await notify(`❌ EP${no} 逐字稿修正失敗，${EDIT_RETRY_MS / 60_000} 分鐘後重試：${msg}`);
        })
        .finally(() => queued.delete(no));
    }
  };
  const timer = setInterval(check, intervalMs);
  check();
  return () => clearInterval(timer);
}

// A retranscription replaces the whole transcript, so the edits in the old one are put back
// into the new one, each near where it was (applyEdits). `save` records where they landed;
// call it once the new segments are saved. `message` is null when there were none.
export function putBackEdits(
  db: DB,
  episodeId: number,
  episodeNo: number,
  segments: Segment[],
): { segments: Segment[]; save: () => void; message: string | null } {
  const edits = appliedEdits(db, episodeId);
  if (!edits.length) return { segments, save: () => {}, message: null };
  const res = applyEdits(segments, edits);
  const { done, missing } = counted(res.results);
  return {
    segments: res.segments,
    save: () => recordEditResults(db, res.results, '重新轉錄後找不到原文'),
    message:
      `✏️ EP${episodeNo} 重新轉錄後套回 ${done}/${edits.length} 處逐字稿修正` +
      (missing ? `\n⚠️ ${missing} 處找不到原文，沒辦法自動套回${adminLink(episodeNo)}` : ''),
  };
}
