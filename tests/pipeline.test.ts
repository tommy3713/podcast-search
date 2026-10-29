import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DB, EMBEDDING_DIM, openDb } from '@/lib/db.ts';
import type { Summary } from '@/lib/summary.ts';

const mocks = vi.hoisted(() => ({
  transcribe: vi.fn(),
  summarize: vi.fn(),
  embed: vi.fn(),
  notify: vi.fn(),
}));
vi.mock('../worker/audio.ts', () => ({ download: vi.fn(), compress: vi.fn(async () => ({ parts: [], duration: 3000 })) }));
vi.mock('../worker/transcribe.ts', () => ({ transcribe: mocks.transcribe }));
vi.mock('../worker/summarize.ts', () => ({ summarize: mocks.summarize }));
vi.mock('../worker/embed.ts', () => ({ embed: mocks.embed }));
vi.mock('../worker/notify.ts', () => ({ notify: mocks.notify }));

const { processEpisode, retryButtons } = await import('../worker/pipeline.ts');
const { checkAction, runEpisodeAction } = await import('../worker/actions.ts');
const { getEpisode, insertDiscovered } = await import('../worker/repo.ts');
const { parseCallback, parseCommand, statusLine } = await import('../worker/bot.ts');

const summary: Summary = { line: '一句話', keys: [], chapters: [], stocks: [], mentions: [] };
const segments = [{ start: 0, end: 5, text: '開場' }];

let db: DB;
beforeEach(() => {
  vi.clearAllMocks();
  db = openDb(':memory:');
  insertDiscovered(db, {
    guid: 'g710', episodeNo: 710, title: '🐧', publishedAt: '2026-10-31T07:00:00.000Z', audioUrl: 'https://x/710.mp3', duration: 3000,
  });
  mocks.transcribe.mockResolvedValue({ segments, billedSeconds: 3000 });
  mocks.summarize.mockResolvedValue({ summary, costUsd: 0.3 });
  mocks.embed.mockResolvedValue({ vectors: [Array(EMBEDDING_DIM).fill(0)], costUsd: 0.0001 });
});

const row = () => getEpisode(db, 710)!;

describe('checkpoints', () => {
  it('runs all three steps for a new episode', async () => {
    expect(await processEpisode(db, row())).toBe(true);
    expect(row()).toMatchObject({ status: 'done', failed_step: null, summary_draft_json: null });
    expect(row().cost_usd).toBeCloseTo(0.0925 + 0.3 + 0.0001, 3);
  });

  it('resumes after a summary failure without transcribing again', async () => {
    mocks.summarize.mockRejectedValueOnce(new Error('OpenAI 429'));
    expect(await processEpisode(db, row())).toBe(false);
    expect(row()).toMatchObject({ status: 'failed', failed_step: 'summarize', retries: 1 });
    expect(mocks.notify.mock.calls[0]![0]).toContain('逐字稿已保存');

    await processEpisode(db, row());
    expect(mocks.transcribe).toHaveBeenCalledTimes(1);
    expect(mocks.summarize).toHaveBeenCalledTimes(2);
    expect(row().status).toBe('done');
  });

  it('resumes after an embedding failure without summarizing again', async () => {
    mocks.embed.mockRejectedValueOnce(new Error('timeout'));
    await processEpisode(db, row());
    expect(row()).toMatchObject({ failed_step: 'embed' });
    expect(row().summary_draft_json).not.toBeNull();

    await processEpisode(db, row());
    expect(mocks.transcribe).toHaveBeenCalledTimes(1);
    expect(mocks.summarize).toHaveBeenCalledTimes(1);
    expect(row()).toMatchObject({ status: 'done', summary_draft_json: null });
  });

  it('keeps a live episode live when a re-run fails', async () => {
    await processEpisode(db, row());
    mocks.summarize.mockRejectedValueOnce(new Error('boom'));
    expect(await runEpisodeAction(db, 'resummarize', 710)).toBe(false);
    expect(row()).toMatchObject({ status: 'done', failed_step: 'summarize', retries: 0 });
    expect(mocks.notify.mock.calls.at(-1)![0]).toContain('網站上仍是舊版');
    // and /retry can finish it
    expect(checkAction(db, 'retry', 710)).toBeNull();
    await runEpisodeAction(db, 'retry', 710);
    expect(row().failed_step).toBeNull();
    expect(mocks.transcribe).toHaveBeenCalledTimes(1);
  });

  it('re-transcribes only when asked', async () => {
    await processEpisode(db, row());
    await runEpisodeAction(db, 'resummarize', 710);
    expect(mocks.transcribe).toHaveBeenCalledTimes(1);
    await runEpisodeAction(db, 'retranscribe', 710);
    expect(mocks.transcribe).toHaveBeenCalledTimes(2);
    expect(mocks.summarize).toHaveBeenCalledTimes(3);
  });
});

describe('actions', () => {
  it('refuses actions that make no sense', async () => {
    expect(checkAction(db, 'resummarize', 710)).toContain('還沒有逐字稿');
    expect(checkAction(db, 'retry', 999)).toContain('還沒收錄');
    await processEpisode(db, row());
    expect(checkAction(db, 'retry', 710)).toContain('已經上線');
  });

  it('labels retry buttons with the step and cost', () => {
    const b = retryButtons({ episode_no: 710, duration: 3000 }, 'summarize').flat();
    expect(b.map((x) => x.data)).toEqual(['retry:710', 'resummarize:710', 'retranscribe:710']);
    expect(b[0]!.text).toContain('整理重點');
    expect(retryButtons({ episode_no: 710, duration: 3000 }, 'transcribe').flat().map((x) => x.data)).toEqual([
      'resummarize:710',
      'retranscribe:710',
    ]);
  });
});

describe('bot parsing', () => {
  it('parses commands', () => {
    expect(parseCommand('/retry 710')).toEqual({ cmd: 'retry', arg: '710' });
    expect(parseCommand('/status@GooayeBot')).toEqual({ cmd: 'status', arg: undefined });
    expect(parseCommand('hello')).toBeNull();
    expect(parseCommand('/retry 710 extra')).toBeNull();
  });

  it('accepts only known button payloads', () => {
    expect(parseCallback('resummarize:709')).toEqual({ action: 'resummarize', episodeNo: 709 });
    expect(parseCallback('delete:709')).toBeNull();
    expect(parseCallback('retry:709;drop')).toBeNull();
  });

  it('describes episode state', async () => {
    mocks.summarize.mockRejectedValueOnce(new Error('x'));
    await processEpisode(db, row());
    expect(statusLine(row())).toBe('EP710 🐧 ❌ 「整理重點」失敗 1 次・US$0.09');
  });
});
