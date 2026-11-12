import type { DB } from '@/lib/db.ts';
import { NO_SEEK_TABLE, type SeekTable } from '@/lib/seek.ts';
import { episodesWithoutSeekTable, saveSeekTable } from './repo.ts';
import { fetchSeekTable } from './seek-table.ts';

type Fetch = (url: string) => Promise<SeekTable | null>;

// An episode whose download keeps failing is left alone until the worker restarts, rather
// than downloaded again every time the queue goes idle
const MAX_FAILURES = 3;
const failures = new Map<number, number>();
export function resetSeekFailures(): void {
  failures.clear();
}

// Works out the seek table of every live episode that lacks one (new episodes get theirs in
// the transcribe step, from the audio it downloads anyway): each is one download of its
// audio (about 50 MB, read as it arrives, nothing saved), so a backlog takes a while but costs
// nothing. A failed download leaves the episode for the next run and the rest carry on.
export async function indexSeekTables(
  db: DB,
  opts: { only?: number; fetch?: Fetch } = {},
): Promise<{ episodes: number; failed: number[] }> {
  const get = opts.fetch ?? fetchSeekTable;
  const todo = episodesWithoutSeekTable(db).filter((e) => opts.only === undefined || e.episode_no === opts.only);
  let episodes = 0;
  const failed: number[] = [];
  for (const e of todo) {
    if ((failures.get(e.id) ?? 0) >= MAX_FAILURES) continue;
    try {
      saveSeekTable(db, e.id, (await get(e.audio_url)) ?? NO_SEEK_TABLE);
      episodes++;
    } catch (err) {
      console.error(`seek table: EP${e.episode_no} failed`, err);
      failures.set(e.id, (failures.get(e.id) ?? 0) + 1);
      failed.push(e.episode_no);
    }
  }
  if (episodes || failed.length) {
    console.log(`seek table: ${episodes} episodes${failed.length ? `; failed EP${failed.join(', EP')}` : ''}`);
  }
  return { episodes, failed };
}

// Off the job queue: it only writes seek_json, so it can't get in a job's way, and a restart
// mid-download loses nothing. Kept off the queue so a backlog of downloads doesn't hold up
// polls, or a deploy (which waits for the queue to be idle). Calls while it runs make it go
// round once more, for an episode published in the meantime.
let running: Promise<void> | null = null;
let again = false;
export function startSeekIndex(db: DB, fetch?: Fetch): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await indexSeekTables(db, { fetch });
      } while (again);
    } catch (err) {
      console.error('seek table failed', err);
    } finally {
      running = null;
    }
  })();
  return running;
}
