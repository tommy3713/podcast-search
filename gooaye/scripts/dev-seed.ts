// Builds a local database for UI work from the prototype's sample data plus real RSS
// metadata (titles, dates, audio URLs). Usage: tsx scripts/dev-seed.ts data/dev.db
import fs from 'node:fs';
import { openDb } from '../src/lib/db.ts';
import type { Segment } from '../src/lib/segments.ts';
import type { Summary } from '../src/lib/summary.ts';
import { fetchFeed, parseFeed } from '../worker/rss.ts';

type Fixture = {
  ep686: { summary: Summary; segments: Segment[] };
  rows: { no: number; minutes: number; line: string; stocks: string[] }[];
};

const file = process.argv[2];
if (!file) throw new Error('usage: dev-seed.ts <db file>');
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/dev-episodes.json', import.meta.url), 'utf8')) as Fixture;
const feed = new Map(parseFeed(await fetchFeed()).map((e) => [e.episodeNo, e]));

fs.rmSync(file, { force: true });
fs.rmSync(`${file}-wal`, { force: true });
fs.rmSync(`${file}-shm`, { force: true });
const db = openDb(file);
const insert = db.prepare(
  `INSERT INTO episodes (episode_no, guid, title, published_at, audio_url, duration, status, segments_json, summary_json)
   VALUES (?, ?, ?, ?, ?, ?, 'done', ?, ?)`,
);

const episodes: { no: number; duration: number; summary: Summary; segments: Segment[] | null }[] = [
  { no: 686, duration: fixture.ep686.segments.at(-1)!.end, ...fixture.ep686 },
  ...fixture.rows.map((r) => ({
    no: r.no,
    duration: r.minutes * 60,
    segments: null,
    summary: {
      line: r.line,
      keys: [],
      chapters: [],
      stocks: r.stocks.map((name) => ({ name, code: null, t: 0, note: '' })),
      mentions: [],
    },
  })),
];

db.transaction(() => {
  for (const e of episodes) {
    const rss = feed.get(e.no);
    if (!rss) continue;
    insert.run(e.no, rss.guid, rss.title, rss.publishedAt, rss.audioUrl, rss.duration ?? e.duration,
      e.segments && JSON.stringify(e.segments), JSON.stringify(e.summary));
  }
})();
console.log(`${file}: ${(db.prepare('SELECT COUNT(*) AS n FROM episodes').get() as { n: number }).n} episodes`);
