import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DB, EMBEDDING_DIM, openDb } from '@/lib/db.ts';
import type { Summary } from '@/lib/summary.ts';
import type { RssEpisode } from '../worker/rss.ts';

const mocks = vi.hoisted(() => ({
  transcribe: vi.fn(),
  summarize: vi.fn(),
  embed: vi.fn(),
  notify: vi.fn(),
  fetchFeed: vi.fn(),
}));
vi.mock('../worker/audio.ts', () => ({ download: vi.fn(), compress: vi.fn(async () => ({ parts: [], duration: 3000 })) }));
vi.mock('../worker/transcribe.ts', () => ({ transcribe: mocks.transcribe }));
vi.mock('../worker/summarize.ts', () => ({ summarize: mocks.summarize }));
vi.mock('../worker/embed.ts', () => ({ embed: mocks.embed }));
vi.mock('../worker/notify.ts', () => ({ notify: mocks.notify }));
// fetchFeed hands back parsed episodes, which the identity parseFeed passes through
vi.mock('../worker/rss.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../worker/rss.ts')>()),
  fetchFeed: mocks.fetchFeed,
  parseFeed: (feed: RssEpisode[]) => feed,
}));

const { backfillStatus, backfillStep, cancelBackfill, describePlan, getBackfill, planBackfill, runBackfill, startBackfill } =
  await import('../worker/backfill.ts');
const { addFromFeed, enqueue, onQueueChange, queueState } = await import('../worker/actions.ts');
const { getEpisode, insertDiscovered, workQueue } = await import('../worker/repo.ts');
const { parseBackfillCallback } = await import('../worker/bot.ts');

const summary: Summary = { line: '一句話', keys: [], chapters: [], stocks: [], mentions: [] };
const rss = (n: number, duration: number | null = 3000): RssEpisode => ({
  guid: `g${n}`,
  episodeNo: n,
  title: '⭐',
  publishedAt: '2026-10-28T08:13:55.000Z',
  audioUrl: `https://x/${n}.mp3`,
  duration,
});
// Newest first, as parseFeed returns it: EP1–EP710
const feed = Array.from({ length: 710 }, (_, i) => rss(710 - i));
// One episode's cost with the mocks below: transcription, summary, embeddings
const EPISODE_USD = 0.0925 + 0.3 + 0.0001;

let db: DB;
const live = (n: number) => {
  insertDiscovered(db, rss(n));
  db.prepare(`UPDATE episodes SET status = 'done' WHERE episode_no = ?`).run(n);
};
const plan = (n: number, f = feed) => {
  const p = planBackfill(db, n, f);
  if (typeof p === 'string') throw new Error(p);
  return p;
};
const nos = (p: { episodes: RssEpisode[] }) => p.episodes.map((e) => e.episodeNo);
const lastMessage = () => mocks.notify.mock.calls.at(-1)![0] as string;

beforeEach(() => {
  vi.clearAllMocks();
  db = openDb(':memory:');
  for (let n = 700; n <= 710; n++) live(n);
  mocks.transcribe.mockResolvedValue({ segments: [{ start: 0, end: 5, text: '開場' }], billedSeconds: 3000 });
  mocks.summarize.mockResolvedValue({ summary, costUsd: 0.3 });
  mocks.embed.mockImplementation(async (texts: string[]) => ({ vectors: texts.map(() => Array(EMBEDDING_DIM).fill(0)), costUsd: 0.0001 }));
  mocks.fetchFeed.mockResolvedValue(feed);
});

describe('planBackfill', () => {
  it('takes the n episodes below the oldest one, with hours and an estimated cost', () => {
    const p = plan(3, [...feed.slice(0, 11), rss(699, 3600), rss(698, 1800), rss(697, null), ...feed.slice(14)]);
    expect(nos(p)).toEqual([699, 698, 697]);
    // 50 minutes when the feed has no duration
    expect(p.hours).toBeCloseTo(1 + 0.5 + 50 / 60);
    // Transcription at US$0.111 an hour plus the summary at US$0.006 a minute (config.ts)
    expect(p.cost).toBeCloseTo(140 * (0.111 / 60 + 0.006));
    expect(describePlan(p)).toBe('將補 EP699–697 共 3 集（2.3 小時音檔），預估 US$1.10');
  });

  it('fills holes before an older episode added on its own and offers backfilled failures again', () => {
    live(300); // a /retranscribe 300
    insertDiscovered(db, rss(698), 'backfill');
    db.prepare(`UPDATE episodes SET status = 'failed' WHERE episode_no = 698`).run();
    insertDiscovered(db, rss(697)); // a poll's episode not live yet: workQueue's
    expect(nos(plan(3))).toEqual([699, 698, 696]);
    expect(describePlan(plan(3))).toContain('EP699–696 之間缺的 共 3 集');
    expect(nos(plan(1000)).at(-1)).toBe(1);
    expect(nos(plan(1000))).not.toContain(300);
  });

  it('counts an episode number the feed repeats once', () => {
    expect(nos(plan(3, [...feed.slice(0, 12), rss(699), ...feed.slice(12)]))).toEqual([699, 698, 697]);
  });

  it('explains an empty plan', () => {
    expect(planBackfill(db, 5, feed.filter((e) => e.episodeNo >= 700))).toBe('EP710 之前的集數都已經補齊了');
    expect(planBackfill(openDb(':memory:'), 5, feed)).toBe('資料庫是空的，請先跑 seed');
  });
});

describe('backfillStep', () => {
  it('processes the plan newest first without a message per episode, and reports with the last one', async () => {
    startBackfill(db, plan(2));
    expect(await backfillStep(db)).toBe(true);
    expect(getEpisode(db, 699)).toMatchObject({ status: 'done', source: 'backfill' });
    expect(getEpisode(db, 698)).toBeUndefined();
    expect(mocks.notify).not.toHaveBeenCalled();

    expect(await backfillStep(db)).toBe(false);
    expect(getBackfill(db)).toBeNull();
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    expect(lastMessage()).toBe('📚 補集數完成：EP699–698\n上線 2 集・失敗 0 集・這次花了 US$0.79');
  });

  it('passes over an episode that went live another way, and counts only what this run spent', async () => {
    startBackfill(db, plan(2));
    live(699);
    db.prepare(`UPDATE episodes SET cost_usd = 0.8 WHERE episode_no = 699`).run();
    await backfillStep(db);
    expect(mocks.transcribe).not.toHaveBeenCalled();
    await backfillStep(db);
    expect(getEpisode(db, 698)?.status).toBe('done');
    expect(lastMessage()).toContain(`這次花了 US$${EPISODE_USD.toFixed(2)}`);
  });

  it('carries on after one failure, stops after two in a row, and leaves failures to the next backfill', async () => {
    startBackfill(db, plan(10));
    mocks.transcribe.mockRejectedValueOnce(new Error('Groq 429'));
    expect(await backfillStep(db)).toBe(true);
    expect(getBackfill(db)?.failures).toBe(1);
    expect(mocks.notify.mock.calls[0]![0]).toContain('（第 1 次，下次 /backfill 會重試）');
    expect(await backfillStep(db)).toBe(true);
    expect(getBackfill(db)?.failures).toBe(0);

    mocks.transcribe.mockRejectedValue(new Error('Groq 429'));
    expect(await backfillStep(db)).toBe(true);
    expect(await backfillStep(db)).toBe(false);
    expect(getBackfill(db)).toBeNull();
    expect(lastMessage()).toBe(
      '⏸ 補集數停止：連續 2 次失敗：EP699–690\n上線 1 集・失敗 3 集・還沒補 6 集・這次花了 US$0.39\n' +
        '失敗：EP699「轉錄」、EP697「轉錄」、EP696「轉錄」（下次 /backfill 會重試，也可以 /retry）',
    );
    // Polls leave them alone, with their real failure count; the next backfill starts with them
    expect(workQueue(db)).toEqual([]);
    expect(getEpisode(db, 699)?.retries).toBe(1);
    expect(nos(plan(4))).toEqual([699, 697, 696, 695]);
  });

  it('retries a failed episode with the audio URL the feed has now', async () => {
    insertDiscovered(db, { ...rss(699), audioUrl: 'https://old/699.mp3' }, 'backfill');
    db.prepare(`UPDATE episodes SET status = 'failed' WHERE episode_no = 699`).run();
    startBackfill(db, plan(1));
    await backfillStep(db);
    expect(getEpisode(db, 699)).toMatchObject({ status: 'done', audio_url: 'https://x/699.mp3' });
  });

  it('skips an episode it cannot add, which counts as a failure', async () => {
    mocks.fetchFeed.mockResolvedValue(feed.filter((e) => e.episodeNo !== 699 && e.episodeNo !== 697 && e.episodeNo !== 696));
    startBackfill(db, plan(5));
    expect(await backfillStep(db)).toBe(true);
    expect(lastMessage()).toContain('EP699 加不進資料庫');
    expect(await backfillStep(db)).toBe(true);
    expect(getBackfill(db)?.failures).toBe(0);
    // A feed that lost its older items stops the run instead of skipping through it
    expect(await backfillStep(db)).toBe(true);
    expect(await backfillStep(db)).toBe(false);
    expect(lastMessage()).toBe(
      '⏸ 補集數停止：連續 2 次失敗：EP699–695\n上線 1 集・失敗 0 集・跳過 3 集・還沒補 1 集・這次花了 US$0.39\n跳過：EP699、EP697、EP696',
    );
  });

  it('stops after the episode in progress when cancelled', async () => {
    startBackfill(db, plan(10));
    let release!: () => void;
    mocks.summarize.mockImplementationOnce(() => new Promise((r) => (release = () => r({ summary, costUsd: 0.3 }))));
    const step = enqueue('補集數 EP699', () => backfillStep(db));
    await vi.waitFor(() => expect(release).toBeDefined());
    expect(cancelBackfill(db)).toBe('⏹ 補集數已停止（處理中的那集會做完）：EP699–690\n上線 0 集・失敗 0 集・還沒補 10 集・這次花了 US$0.000');
    release();
    expect(await step).toBe(false);
    expect(getEpisode(db, 699)?.status).toBe('done');
    expect(await backfillStep(db)).toBe(false);
    expect(getEpisode(db, 698)).toBeUndefined();
    expect(cancelBackfill(db)).toBeNull();
    // Between episodes nothing is in progress
    startBackfill(db, plan(3));
    expect(cancelBackfill(db)).toMatch(/^⏹ 補集數已停止：EP698–696\n/);
  });

  it('leaves a backfill started while its episode ran alone', async () => {
    startBackfill(db, plan(10));
    let fail!: () => void;
    mocks.summarize.mockImplementationOnce(() => new Promise((_, reject) => (fail = () => reject(new Error('boom')))));
    const step = backfillStep(db);
    await vi.waitFor(() => expect(fail).toBeDefined());
    cancelBackfill(db);
    await new Promise((r) => setTimeout(r, 2));
    const next = startBackfill(db, plan(5));
    fail();
    // The loop goes on with the new one, which keeps a clean failure count
    expect(await step).toBe(true);
    expect(getBackfill(db)).toEqual(next);
  });

  it('carries on with the episode a restart cut off', async () => {
    startBackfill(db, plan(2));
    // The worker died mid-transcription: the row exists, the plan still points at it
    addFromFeed(db, feed, 699, 'backfill');
    db.prepare(`UPDATE episodes SET status = 'transcribing' WHERE episode_no = 699`).run();
    expect(workQueue(db)).toEqual([]);
    expect(nos(plan(1))).toEqual([699]);
    await backfillStep(db);
    expect(getEpisode(db, 699)?.status).toBe('done');
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});

describe('status and buttons', () => {
  it('tells what /backfill does, or the progress', async () => {
    expect(backfillStatus(db)).toBe('目前沒有在補集數。例如 /backfill 20 會補缺少的集數中最新的 20 集（包括之前補失敗的）');
    startBackfill(db, plan(20));
    await backfillStep(db);
    expect(backfillStatus(db)).toBe('📚 補集數中：EP699–680\n上線 1 集・失敗 0 集・還沒補 19 集・這次花了 US$0.39');
  });

  it('parses only well-formed confirm buttons within the limit', () => {
    expect(parseBackfillCallback('backfill:20:699')).toEqual({ n: 20, first: 699 });
    expect(parseBackfillCallback('backfill:200:699')).toEqual({ n: 200, first: 699 });
    expect(parseBackfillCallback('backfill:201:699')).toBeNull();
    expect(parseBackfillCallback('backfill:0:699')).toBeNull();
    expect(parseBackfillCallback('backfill:699-680')).toBeNull();
    expect(parseBackfillCallback('retry:699')).toBeNull();
  });
});

describe('runBackfill', () => {
  it('queues one episode at a time and leaves the queue idle between them', async () => {
    startBackfill(db, plan(3));
    const seen: string[] = [];
    onQueueChange(() => {
      const { running, waiting } = queueState();
      seen.push(running ?? (waiting ? 'waiting' : 'idle'));
    });
    await runBackfill(db, 0);
    onQueueChange(null);
    expect([699, 698, 697].map((n) => getEpisode(db, n)?.status)).toEqual(['done', 'done', 'done']);
    // Each episode is its own job with an idle queue after it; the last one reports
    const job = (label: string) => `waiting ${label} idle`;
    expect(seen.join(' ')).toBe([job('補集數 EP699'), job('補集數 EP698'), job('補集數 EP697')].join(' '));
    expect(lastMessage()).toContain('📚 補集數完成：EP699–697');
  });

  it('tries the same episode again after the feed could not be read once', async () => {
    startBackfill(db, plan(2));
    mocks.fetchFeed.mockRejectedValueOnce(new Error('RSS 503'));
    await runBackfill(db, 0);
    expect(mocks.notify.mock.calls[0]![0]).toBe('⚠️ 補集數讀取 RSS 失敗：RSS 503\n兩分鐘後再試 EP699');
    expect(getBackfill(db)).toBeNull();
    expect([699, 698].map((n) => getEpisode(db, n)?.status)).toEqual(['done', 'done']);
    expect(lastMessage()).toBe('📚 補集數完成：EP699–698\n上線 2 集・失敗 0 集・這次花了 US$0.79');
  });

  it('stops, keeping what it did, when the feed stays unreadable', async () => {
    startBackfill(db, plan(3));
    await backfillStep(db);
    mocks.fetchFeed.mockRejectedValue(new Error('RSS 503'));
    await runBackfill(db, 0);
    expect(getBackfill(db)).toBeNull();
    expect(lastMessage()).toBe(
      '⏸ 補集數停止：連續 2 次失敗（最後一次是讀取 RSS：RSS 503）：EP699–697\n上線 1 集・失敗 0 集・還沒補 2 集・這次花了 US$0.39',
    );
  });

  it('passes over live episodes without pausing', async () => {
    startBackfill(db, plan(2));
    live(699);
    live(698);
    // A pause would outlast the test's timeout
    await runBackfill(db, 60_000);
    expect(lastMessage()).toBe('📚 補集數完成：EP699–698\n上線 2 集・失敗 0 集・這次花了 US$0.000');
  });
});

describe('workQueue', () => {
  it('puts a new episode before older retries and leaves backfilled ones out', () => {
    insertDiscovered(db, rss(711));
    insertDiscovered(db, rss(650));
    insertDiscovered(db, rss(640), 'backfill');
    expect(workQueue(db).map((r) => r.episode_no)).toEqual([711, 650]);
  });
});
