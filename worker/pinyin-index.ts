import type { DB } from '@/lib/db.ts';
import { toPinyin } from '@/lib/pinyin.ts';
import { chunksWithoutPinyin, savePinyin } from './repo.ts';

const BATCH = 300; // a few tenths of a second of conversion, then the event loop gets a turn

// Works out the pinyin of live episodes' chunks that lack it: those published before it
// existed, or by the previous release during a deploy. No API call, only CPU (about 3 s for
// 212 episodes), and each batch is written on its own, so an interrupted run carries on
// where it stopped.
export async function indexPinyin(db: DB): Promise<{ chunks: number; episodes: number }> {
  let chunks = 0;
  let after = 0;
  const episodes = new Set<number>();
  for (;;) {
    const rows = chunksWithoutPinyin(db, after, BATCH);
    if (!rows.length) break;
    chunks += savePinyin(
      db,
      rows.map((r) => ({ id: r.id, text: r.text, pinyin: toPinyin(r.text) })),
    );
    after = rows.at(-1)!.id;
    for (const r of rows) episodes.add(r.episode_no);
    await new Promise((r) => setImmediate(r));
  }
  if (chunks) console.log(`pinyin index: ${chunks} chunks in ${episodes.size} episodes`);
  return { chunks, episodes: episodes.size };
}
