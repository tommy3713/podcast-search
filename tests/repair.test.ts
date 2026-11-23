import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DB, EMBEDDING_DIM, openDb } from '@/lib/db.ts';
import type { Segment } from '@/lib/segments.ts';
import type { RssEpisode } from '../worker/rss.ts';

const mocks = vi.hoisted(() => ({ repairTranscript: vi.fn(), embed: vi.fn(), notify: vi.fn(), download: vi.fn() }));
const audio = vi.hoisted(() => ({ duration: 60 }));
vi.mock('../worker/audio.ts', () => ({
  download: mocks.download,
  compress: vi.fn(async () => ({ parts: [{ file: 'a.mp3', offset: 0, duration: audio.duration }], duration: audio.duration })),
}));
vi.mock('../worker/transcribe.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../worker/transcribe.ts')>()),
  repairTranscript: mocks.repairTranscript,
}));
vi.mock('../worker/embed.ts', () => ({ embed: mocks.embed }));
vi.mock('../worker/notify.ts', () => ({ notify: mocks.notify }));

const { cancelRepair, describePlan, getRepair, planRepair, repairEpisode, repairStep, runRepair, startRepair } = await import('../worker/repair.ts');
const { insertDiscovered, repairRows, saveSegments } = await import('../worker/repo.ts');
const { parseRepairCallback } = await import('../worker/bot.ts');
const { isReleaseHours, taipeiTime } = await import('../worker/schedule.ts');

const HALLUCINATION = '請不吝點贊 訂閱 轉發 打賞支持明鏡與點點欄目';
const SPOKEN = '這邊提供給所有有需要的朋友，那這個禮拜我姐招待我們全家跑去日月潭玩';
const ok: Segment[] = [
  { start: 0, end: 5, text: '開頭的話。' },
  { start: 5, end: 55, text: SPOKEN.repeat(8) },
  { start: 55, end: 60, text: '後面的話。' },
];
const bad: Segment[] = [
  { start: 0, end: 5, text: '開頭的話。' },
  { start: 5, end: 35, text: HALLUCINATION },
  { start: 35, end: 55, text: SPOKEN.repeat(4) },
  { start: 55, end: 60, text: '後面的話。' },
];
const fixed: Segment[] = [bad[0]!, { start: 5, end: 20, text: SPOKEN }, { start: 20, end: 35, text: SPOKEN }, bad[2]!, bad[3]!];

let db: DB;
const rss = (n: number): RssEpisode => ({ guid: `g${n}`, episodeNo: n, title: '⭐', publishedAt: '2026-10-28T08:13:55.000Z', audioUrl: `https://x/${n}.mp3`, duration: 60 });
const live = (n: number, segs: Segment[]) => {
  insertDiscovered(db, rss(n));
  db.prepare(
    `UPDATE episodes SET status = 'done', duration = 60, cost_usd = 1, repair_due = 1, updated_at = '2026-01-01T00:00:00Z', segments_json = ? WHERE episode_no = ?`,
  ).run(
    JSON.stringify(segs),
    n,
  );
};
const row = (n: number) =>
  db.prepare('SELECT id, segments_json, cost_usd, updated_at FROM episodes WHERE episode_no = ?').get(n) as {
    id: number;
    segments_json: string;
    cost_usd: number;
    updated_at: string;
  };
const chunkCount = (n: number) => (db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE episode_id = ?').get(row(n).id) as { n: number }).n;
const plan = (n?: number) => {
  const p = planRepair(db, n);
  if (typeof p === 'string') throw new Error(p);
  return p;
};
const recovered = (segments: Segment[]) => ({
  segments,
  billedSeconds: 60,
  windows: 1,
  changes: [{ start: 5, end: 35, outcome: 'recovered', before: [bad[1]], after: fixed.slice(1, 3) }],
});

beforeEach(() => {
  vi.clearAllMocks();
  db = openDb(':memory:');
  live(700, ok);
  live(701, bad);
  live(702, bad);
  live(703, bad);
  mocks.download.mockReset();
  audio.duration = 60;
  mocks.repairTranscript.mockReset().mockResolvedValue(recovered(fixed));
  mocks.embed.mockImplementation(async (texts: string[]) => ({ vectors: texts.map(() => Array(EMBEDDING_DIM).fill(0)), costUsd: 0.0005 }));
});

describe('planRepair', () => {
  it('takes the newest live episodes with a span to redo, leaving out repaired ones', async () => {
    expect(plan().episodes).toEqual([
      { no: 703, windows: 1 },
      { no: 702, windows: 1 },
      { no: 701, windows: 1 },
    ]);
    expect(plan(2).episodes.map((e) => e.no)).toEqual([703, 702]);
    // Two passes of the 32 s window at US$0.111 an hour, plus the embeddings
    expect(plan(1).cost).toBeCloseTo((64 / 3600) * 0.111 + 0.0005);
    expect(describePlan(plan())).toBe('將修補 EP703–701 中 3 集的逐字稿（共 3 處要重轉），預估最多 US$0.007');
    await repairEpisode(db, 703);
    expect(plan().episodes.map((e) => e.no)).toEqual([702, 701]);
  });

  it('leaves out transcripts made since spans are repaired as they are transcribed', () => {
    saveSegments(db, row(703).id, bad, 60, 0);
    expect(plan().episodes.map((e) => e.no)).toEqual([702, 701]);
  });

  it("never counts an admin's applied correction as suspect", () => {
    const short = { start: 5, end: 35, text: '他說今天先這樣。' };
    db.prepare('UPDATE episodes SET segments_json = ? WHERE episode_no = 703').run(JSON.stringify([bad[0], short, bad[2], bad[3]]));
    expect(plan().episodes.map((e) => e.no)).toContain(703);
    db.prepare(
      `INSERT INTO transcript_edits (episode_id, seg_start, old_text, new_text, applied_at) VALUES (?, 5, ?, ?, '2026-11-20T00:00:00Z')`,
    ).run(row(703).id, HALLUCINATION, short.text);
    expect(plan().episodes.map((e) => e.no)).not.toContain(703);
  });

  it('judges a transcript by the prompt it was made with', () => {
    const echo = { start: 5, end: 9, text: '我們來聊聊美元指數跟日圓匯率還有黃金' };
    db.prepare('UPDATE episodes SET segments_json = ? WHERE episode_no = 703').run(JSON.stringify([bad[0], echo, { start: 9, end: 60, text: SPOKEN.repeat(8) }]));
    expect(plan().episodes.map((e) => e.no)).not.toContain(703);
    const { lastInsertRowid } = db.prepare('INSERT INTO whisper_prompts (text) VALUES (?)').run('我們來聊聊美元指數跟日圓匯率還有黃金價格');
    db.prepare('UPDATE episodes SET whisper_prompt_id = ? WHERE episode_no = 703').run(lastInsertRowid);
    expect(plan().episodes.map((e) => e.no)).toContain(703);
  });

  it('says so when nothing is left', () => {
    db = openDb(':memory:');
    live(700, ok);
    expect(planRepair(db)).toBe('沒有需要修補的集數');
  });
});

describe('repairEpisode', () => {
  it('swaps in a changed transcript with its chunks and records the repair', async () => {
    const r = await repairEpisode(db, 701);
    expect(r).toMatchObject({ changed: true, recovered: 1, dropped: 0 });
    expect(JSON.parse(row(701).segments_json)).toEqual(fixed);
    expect(chunkCount(701)).toBeGreaterThan(0);
    expect(row(701).updated_at).not.toBe('2026-01-01T00:00:00Z');
    expect(row(701).cost_usd).toBeCloseTo(1 + (60 / 3600) * 0.111 + 0.0005);
    const [rec] = repairRows(db, 701);
    expect(rec).toMatchObject({ episode_no: 701, windows: 1, recovered: 1, dropped: 0, kept: 0 });
    expect(rec!.changes[0]!.before).toEqual([bad[1]]);
  });

  it('records a repair that kept everything without touching the transcript', async () => {
    mocks.repairTranscript.mockResolvedValue({ segments: bad, billedSeconds: 60, windows: 1, changes: [{ start: 5, end: 35, outcome: 'kept', before: [bad[1]], after: [bad[1]] }] });
    const r = await repairEpisode(db, 701);
    expect(r.changed).toBe(false);
    expect(mocks.embed).not.toHaveBeenCalled();
    expect(row(701).segments_json).toBe(JSON.stringify(bad));
    expect(row(701).updated_at).toBe('2026-01-01T00:00:00Z');
    expect(chunkCount(701)).toBe(0);
    expect(repairRows(db, 701)[0]).toMatchObject({ kept: 1 });
  });

  it('refuses when the transcript changed while it was being repaired', async () => {
    mocks.repairTranscript.mockImplementation(async () => {
      db.prepare('UPDATE episodes SET segments_json = ? WHERE episode_no = 701').run(JSON.stringify(ok));
      return recovered(fixed);
    });
    await expect(repairEpisode(db, 701)).rejects.toThrow('逐字稿在修補時被改過');
    expect(row(701).segments_json).toBe(JSON.stringify(ok));
    expect(repairRows(db, 701)).toEqual([]);
  });

  it('passes over an episode repaired already, as after a restart right after its save', async () => {
    await repairEpisode(db, 701);
    const r = await repairEpisode(db, 701);
    expect(r.changed).toBe(false);
    expect(mocks.repairTranscript).toHaveBeenCalledTimes(1);
    expect(repairRows(db, 701)).toHaveLength(1);
  });

  it('leaves out an episode whose audio is no longer as long as its transcript', async () => {
    audio.duration = 80;
    const r = await repairEpisode(db, 701);
    expect(r.skipped).toBe('音檔長度和逐字稿不符（80 秒，逐字稿是 60 秒），可能重新上傳過');
    expect(mocks.repairTranscript).not.toHaveBeenCalled();
    expect(row(701).segments_json).toBe(JSON.stringify(bad));
    expect(plan().episodes.map((e) => e.no)).toEqual([703, 702]);
  });

  it('passes the prompt the transcript was made with and keeps the edited segments', async () => {
    db.prepare(`INSERT INTO transcript_edits (episode_id, seg_start, old_text, new_text, applied_at) VALUES (?, 35, 'x', ?, '2026-11-20T00:00:00Z')`).run(
      row(701).id,
      bad[2]!.text,
    );
    await repairEpisode(db, 701);
    const opts = mocks.repairTranscript.mock.calls[0]![2];
    expect(opts.judgePrompt).toContain('歡迎收聽股癌');
    expect(opts.keep(bad[2])).toBe(true);
    expect(opts.keep(bad[1])).toBe(false);
  });

  it('refuses an episode that is not live', async () => {
    await expect(repairEpisode(db, 999)).rejects.toThrow('EP999 不在網站上');
  });
});

describe('repairStep', () => {
  it('goes through the plan and reports once at the end', async () => {
    startRepair(db, plan());
    expect(await repairStep(db)).toBe(true);
    expect(await repairStep(db)).toBe(true);
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(await repairStep(db)).toBe(false);
    expect(getRepair(db)).toBeNull();
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    expect(mocks.notify.mock.calls[0]![0]).toMatch(/🩹 逐字稿修補完成：EP703–701\n修了 3 集（逐字稿有改的 3 集，救回 3 處、刪掉 0 處）・這次花了/);
  });

  it('reports a skipped episode without counting it a failure', async () => {
    audio.duration = 80;
    startRepair(db, plan(2));
    expect(await repairStep(db)).toBe(true);
    expect(await repairStep(db)).toBe(false);
    expect(mocks.notify.mock.calls[0]![0]).toMatch(/^⚠️ EP703 逐字稿修補跳過：音檔長度/);
    expect(mocks.notify.mock.calls.at(-1)![0]).toContain('・跳過 2 集');
  });

  it('reports a failed episode, carries on, and stops after two in a row', async () => {
    mocks.download.mockRejectedValueOnce(new Error('download 404'));
    startRepair(db, plan());
    expect(await repairStep(db)).toBe(true);
    expect(mocks.notify.mock.calls[0]![0]).toBe('⚠️ EP703 逐字稿修補失敗：download 404');
    expect(await repairStep(db)).toBe(true);
    expect(getRepair(db)).toMatchObject({ next: 2, failures: 0, failed: [703] });

    mocks.download.mockRejectedValue(new Error('download 404'));
    startRepair(db, plan());
    expect(getRepair(db)!.episodes).toEqual([703, 701]);
    expect(await repairStep(db)).toBe(true);
    expect(await repairStep(db)).toBe(false);
    expect(mocks.notify.mock.calls.at(-1)![0]).toMatch(/^⏸ 逐字稿修補停止：連續 2 集失敗/);
    expect(mocks.notify.mock.calls.at(-1)![0]).toContain('失敗：EP703、EP701（下次 /repair 會再排進去）');
  });

  it('is stopped by /repair stop, letting the episode in progress finish', async () => {
    startRepair(db, plan());
    mocks.repairTranscript.mockImplementation(async () => {
      expect(cancelRepair(db)).toMatch(/^⏹ 逐字稿修補已停止/);
      return recovered(fixed);
    });
    expect(await repairStep(db)).toBe(false);
    expect(JSON.parse(row(703).segments_json)).toEqual(fixed);
    expect(getRepair(db)).toBeNull();
  });
});

describe('runRepair', () => {
  it('waits out release days, then works through the run', async () => {
    startRepair(db, plan(2));
    // Wednesday 2026-11-25 15:00 Taipei, then Thursday
    const times = [new Date('2026-11-25T07:00:00Z'), new Date('2026-11-25T07:00:00Z')];
    const now = () => times.shift() ?? new Date('2026-11-26T07:00:00Z');
    await runRepair(db, { pauseMs: 0, releaseWaitMs: 0, now });
    expect(times).toEqual([]);
    expect(mocks.repairTranscript).toHaveBeenCalledTimes(2);
    expect(getRepair(db)).toBeNull();
  });
});

describe('isReleaseHours', () => {
  it('is Wednesday and Saturday from 10:00 Taipei', () => {
    expect(isReleaseHours(taipeiTime(new Date('2026-11-25T02:00:00Z')))).toBe(true); // Wed 10:00
    expect(isReleaseHours(taipeiTime(new Date('2026-11-25T01:59:00Z')))).toBe(false); // Wed 09:59
    expect(isReleaseHours(taipeiTime(new Date('2026-11-28T15:59:00Z')))).toBe(true); // Sat 23:59
    expect(isReleaseHours(taipeiTime(new Date('2026-11-26T07:00:00Z')))).toBe(false); // Thu
  });
});

describe('parseRepairCallback', () => {
  it('reads the confirm button', () => {
    expect(parseRepairCallback('repair:695:714')).toEqual({ n: 695, first: 714 });
    expect(parseRepairCallback('repair:0:714')).toBeNull();
    expect(parseRepairCallback('backfill:20:700')).toBeNull();
  });
});
