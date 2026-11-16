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
// Made-up questions for /admin/asks (a live snapshot has none: db:pull strips ask_log),
// one of each outcome and search note, spread over the last few days
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString().slice(0, 19) + 'Z';
const transcript = (query: string, results: number, extra: object = {}) => ({ name: 'search_transcript', args: { query }, results, ...extra });
const asks: [number, string, string, string, string | null, number | null, object[]][] = [
  // minutes ago, user, outcome, question, answer, ms, tool calls
  [20, 'demo1111111', 'answered', '主委最近怎麼看 AI 伺服器？', 'EP686｜他說伺服器需求「還在排隊」[1]，也提到散熱是瓶頸[2]。\n- EP685｜**液冷**會是下一個重點[3]', 7400, [transcript('AI 伺服器', 8), transcript('散熱 液冷', 6)]],
  [95, 'demo2222222', 'no_source', '主委喜歡什麼顏色？', '節目裡沒有提到主委喜歡的顏色。', 4100, [transcript('顏色', 8, { unmatched: true })]],
  [300, 'demo1111111', 'answered', '台積電這幾集說了什麼？', 'EP684｜提到法說會的資本支出[1]。', 9800, [transcript('台積電', 8, { cut: ['台積電'] }), { name: 'search_mentions', args: { category: '股票', keyword: '台積電' }, results: 30 }]],
  [800, 'demo3333333', 'answered', '哪一集講到交言肥腸？', 'EP682｜主委說那家「真的很下飯」[1]。', 18_500, [transcript('交言肥腸', 8, { sound: ['交言肥腸'] })]],
  [1500, 'demo2222222', 'timeout', '把每一集提到的股票全部列出來', null, 30_000, [transcript('股票', 8)]],
  [2400, 'demo4444444', 'moderated', '（不當內容的問題）', null, null, []],
  [3000, 'demo4444444', 'quota', '今天還能問嗎', null, null, []],
];
const insertAsk = db.prepare(
  `INSERT INTO ask_log (user_id, question, created_at, outcome, answer, cited, hits, ms, input_tokens, output_tokens, cost_usd, tool_calls_json, sources_json)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
// The sources a demo answer cites, on the episodes its line's label names, in turn
const demoSources = (answer: string) =>
  answer.split('\n').flatMap((line) => {
    const label = /^(?:- )?((?:EP\d+・)*EP\d+)｜/.exec(line);
    const eps = label ? label[1]!.split('・').map((e) => Number(e.slice(2))) : [];
    if (!eps.length) return [];
    return [...line.matchAll(/\[(\d+)\]/g)].map((m, i) => {
      const ep = eps[i % eps.length]!;
      return {
        n: Number(m[1]),
        ep,
        t: Number(m[1]) * 95,
        text: `（示範段落）EP${ep} 第 ${m[1]} 段逐字稿：實際資料是模型讀到的完整段落，大約 600 字。`,
        label: null,
      };
    });
  });
const insertDay = db.prepare(
  `INSERT INTO ask_daily (date, asks, users, answered, no_source, moderated, quota, failed, cost_usd, avg_ms) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
);
db.transaction(() => {
  for (const [ago, user, outcome, question, answer, ms, calls] of asks.toReversed()) { // oldest first, as the site logs them
    const sources = outcome === 'answered' && answer ? demoSources(answer) : [];
    const cited = answer ? sources.length : null;
    const spent = calls.length ? 0.002 * calls.length : null;
    insertAsk.run(user, question, minutesAgo(ago), outcome, answer, cited, calls.length * 8, ms, calls.length * 1500, answer ? 250 : null, spent,
      JSON.stringify(calls), sources.length ? JSON.stringify(sources) : null);
  }
  for (let d = 40; d >= 1; d--) {
    const date = new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
    const n = 8 + ((d * 7) % 13);
    const none = (d * 3) % 5;
    insertDay.run(date, n, Math.ceil(n / 2), n - none - 1, none, 1, n * 0.006, 6000 + d * 50);
  }
})();
console.log(`${file}: ${(db.prepare('SELECT COUNT(*) AS n FROM episodes').get() as { n: number }).n} episodes, ${asks.length} questions`);
