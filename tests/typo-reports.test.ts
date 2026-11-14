import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DB, EMBEDDING_DIM, openDb } from '@/lib/db.ts';
import type { Segment } from '@/lib/segments.ts';
import type { Summary } from '@/lib/summary.ts';
import { countInSummary, replaceInSummary } from '@/lib/summary-edits.ts';
import { replaceOpen } from '@/lib/transcript-edits.ts';

const mocks = vi.hoisted(() => ({
  summarize: vi.fn(),
  embed: vi.fn(),
  notify: vi.fn(),
  session: vi.fn(),
  moderate: vi.fn(),
  db: undefined as unknown,
}));
vi.mock('../worker/audio.ts', () => ({ download: vi.fn(), compress: vi.fn() }));
vi.mock('../worker/transcribe.ts', () => ({ transcribe: vi.fn() }));
vi.mock('../worker/summarize.ts', () => ({ summarize: mocks.summarize }));
vi.mock('../worker/embed.ts', () => ({ embed: mocks.embed }));
vi.mock('../worker/notify.ts', () => ({ notify: mocks.notify }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/lib/server-db.ts', () => ({ readDb: async () => mocks.db, writeDb: async () => mocks.db }));
vi.mock('openai', () => ({
  default: class {
    moderations = { create: mocks.moderate };
  },
}));

const { applyPendingEdits } = await import('../worker/edits.ts');
const { processEpisode } = await import('../worker/pipeline.ts');
const { getEpisode, insertDiscovered, publishEpisode } = await import('../worker/repo.ts');
const { chunkSegments, summaryPoints } = await import('../worker/chunk.ts');
const { notifyReports, purgeReporters } = await import('../worker/reports.ts');
const { stripAskLog } = await import('../worker/backup.ts');
const { addReport, checkReport, getReport, paragraphSegments, REPORT_DAILY_LIMIT, resolveReport } = await import('@/lib/reports.ts');
const { POST: report } = await import('@/app/api/report/route.ts');
const { POST: resolve } = await import('@/app/api/admin/reports/route.ts');

const seg = (start: number, text: string): Segment => ({ start, end: start + 4, text });

const summary: Summary = {
  line: '聊到交言肥腸和輝達',
  keys: [{ t: 10, text: '交言肥腸很好吃' }],
  chapters: [{ t: 0, title: '開場', ad: false, bullets: [{ t: 10, text: '推薦交言肥腸' }], quote: null }],
  stocks: [{ name: '輝達', code: 'NVDA', t: 50, note: '提到輝達財報' }],
  mentions: [{ category: '美食', name: '交言肥腸', t: 10, quote: '交言肥腸超讚' }],
};

describe('summary edits', () => {
  it('replaces the words in every text a listener reads, not in codes or categories', () => {
    const { summary: s, count } = replaceInSummary(summary, '交言肥腸', '椒鹽肥腸');
    expect(count).toBe(5);
    expect(s.line).toBe('聊到椒鹽肥腸和輝達');
    expect(s.mentions[0]).toMatchObject({ category: '美食', name: '椒鹽肥腸', quote: '椒鹽肥腸超讚' });
    expect(countInSummary(s, '交言肥腸')).toBe(0);
    expect(replaceInSummary(summary, 'NVDA', 'X').count).toBe(0);
    expect(summary.line).toBe('聊到交言肥腸和輝達'); // the input isn't changed
  });

  it("leaves words alone where the suggestion is already written (台積 → 台積電)", () => {
    const s: Summary = { ...summary, line: '台積和台積電', keys: [{ t: 0, text: '台積電法說' }] };
    const r = replaceInSummary(s, '台積', '台積電');
    expect(r.count).toBe(1);
    expect(r.summary.line).toBe('台積電和台積電');
    expect(r.summary.keys[0]!.text).toBe('台積電法說');
    expect(countInSummary(s, '台積', '台積電')).toBe(1);
    expect(replaceOpen('aaa', 'aa', 'b')).toEqual({ text: 'ba', count: 1 });
  });
});

describe('paragraphSegments', () => {
  it('gives the segments of the paragraph starting at a time, as the page groups them', () => {
    const segs = [seg(0, 'a'), seg(10, 'b'), seg(31, 'c'), seg(40, 'd'), seg(62, 'e')];
    expect(paragraphSegments(segs, 0)).toEqual([0, 1]);
    expect(paragraphSegments(segs, 31)).toEqual([2, 3]);
    expect(paragraphSegments(segs, 10)).toEqual([]);
  });
});

// ── an episode ─────────────────────────────────────────────────────────────────

const segments: Segment[] = [seg(0, '大家好'), seg(10, '今天吃交言肥腸'), seg(40, '輝達財報'), seg(70, '又是交言肥腸')];
let db: DB;
let epId: number;
const vector = () => Array(EMBEDDING_DIM).fill(0.1);

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  db = openDb(':memory:');
  mocks.db = db;
  insertDiscovered(db, { guid: 'g709', episodeNo: 709, title: '🐧', publishedAt: '2026-10-31T07:00:00.000Z', audioUrl: 'https://x/709.mp3', duration: 100 });
  epId = getEpisode(db, 709)!.id;
  db.prepare(`UPDATE episodes SET segments_json = ?, duration = 100 WHERE id = ?`).run(JSON.stringify(segments), epId);
  const chunks = chunkSegments(segments);
  const points = summaryPoints(summary);
  publishEpisode(db, epId, { summary, chunks, vectors: chunks.map(vector), points, pointVectors: points.map(vector), costUsd: 0 });
  mocks.embed.mockImplementation(async (texts: string[]) => ({ vectors: texts.map(vector), costUsd: 0.0001 }));
  mocks.moderate.mockResolvedValue({ results: [{ flagged: false }] });
});

const post = (fn: (r: Request) => Promise<Response>, url: string, body: unknown) =>
  fn(new Request(`http://localhost${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const signIn = (id: string) => mocks.session.mockResolvedValue({ user: { id, name: 'x' } });
const reports = () => db.prepare('SELECT id, user_id, status, suggestion FROM typo_reports ORDER BY id').all() as Record<string, unknown>[];
const transcriptReport = { episode: 709, target: 'transcript' as const, at: 0 as number | null, original: '交言肥腸', suggestion: '椒鹽肥腸', note: null };

describe('checkReport', () => {
  it('takes words that are in the paragraph or the summary named', () => {
    // 0 s and 10 s are one paragraph on the page
    expect(checkReport(db, { ...transcriptReport, target: 'transcript' })).toEqual({ ok: true, episodeId: epId });
    expect(checkReport(db, { ...transcriptReport, target: 'transcript', at: 10 }).ok).toBe(false);
    expect(checkReport(db, { ...transcriptReport, target: 'transcript', original: '輝達財報' }).ok).toBe(false);
    expect(checkReport(db, { ...transcriptReport, target: 'summary', at: null, original: '提到輝達' }).ok).toBe(true);
    expect(checkReport(db, { ...transcriptReport, target: 'summary', at: null, original: '大家好' }).ok).toBe(false);
    expect(checkReport(db, { ...transcriptReport, episode: 1 }).ok).toBe(false);
  });
});

describe('POST /api/report', () => {
  it('needs a login', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await post(report, '/api/report', transcriptReport)).status).toBe(401);
    expect(reports()).toEqual([]);
  });

  it('keeps a report, refuses the same one twice and stops at the daily limit', async () => {
    signIn('u1');
    expect((await post(report, '/api/report', transcriptReport)).status).toBe(200);
    expect(reports()).toEqual([{ id: 1, user_id: 'u1', status: 'pending', suggestion: '椒鹽肥腸' }]);
    expect((await post(report, '/api/report', transcriptReport)).status).toBe(409);
    for (let i = 1; i < REPORT_DAILY_LIMIT; i++) {
      expect((await post(report, '/api/report', { ...transcriptReport, suggestion: `椒鹽肥腸${i}` })).status).toBe(200);
    }
    expect((await post(report, '/api/report', { ...transcriptReport, suggestion: '最後一個' })).status).toBe(429);
  });

  it('checks the daily limit in the same transaction as the insert', () => {
    for (let i = 0; i < REPORT_DAILY_LIMIT; i++) expect(addReport(db, 'u9', epId, { ...transcriptReport, suggestion: `建議${i}` }).ok).toBe(true);
    expect(addReport(db, 'u9', epId, { ...transcriptReport, suggestion: '再一個' })).toEqual({ ok: false, reason: 'limit' });
    expect(addReport(db, 'u8', epId, transcriptReport).ok).toBe(true);
    expect(addReport(db, 'u8', epId, transcriptReport)).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('refuses a suggestion that is the same, too long, or flagged', async () => {
    signIn('u1');
    expect((await post(report, '/api/report', { ...transcriptReport, suggestion: '交言肥腸' })).status).toBe(400);
    expect((await post(report, '/api/report', { ...transcriptReport, suggestion: '字'.repeat(31) })).status).toBe(400);
    mocks.moderate.mockResolvedValueOnce({ results: [{ flagged: true }] });
    expect((await post(report, '/api/report', transcriptReport)).status).toBe(400);
    // A moderation outage lets it through: only an admin reads it
    mocks.moderate.mockRejectedValueOnce(new Error('down'));
    expect((await post(report, '/api/report', transcriptReport)).status).toBe(200);
  });
});

// ── admin ──────────────────────────────────────────────────────────────────────

const transcriptEdits = () => db.prepare('SELECT seg_start, old_text, new_text, report_id FROM transcript_edits ORDER BY id').all();
const summaryEdits = () => db.prepare('SELECT old_text, new_text, report_id FROM summary_edits ORDER BY id').all();

describe('POST /api/admin/reports', () => {
  beforeEach(async () => {
    signIn('u1');
    await post(report, '/api/report', transcriptReport);
    signIn('u2');
    await post(report, '/api/report', transcriptReport);
    vi.stubEnv('ADMIN_USER_ID', 'admin');
    signIn('admin');
  });

  it('answers 404 to anyone not an admin', async () => {
    signIn('u1');
    expect((await post(resolve, '/api/admin/reports', { id: 1, action: 'reject', suggestion: '' })).status).toBe(404);
  });

  it('turns "only here" into one edit of the paragraph selected, closing the identical reports', async () => {
    expect((await post(resolve, '/api/admin/reports', { id: 1, action: 'here', suggestion: '椒鹽肥腸' })).status).toBe(200);
    expect(transcriptEdits()).toEqual([{ seg_start: 10, old_text: '今天吃交言肥腸', new_text: '今天吃椒鹽肥腸', report_id: 1 }]);
    expect(reports().map((r) => r.status)).toEqual(['accepted', 'accepted']);
    expect((await post(resolve, '/api/admin/reports', { id: 2, action: 'reject', suggestion: '' })).status).toBe(409);
  });

  it('turns "the whole episode" into an edit per segment, and can fix the summary too', async () => {
    const res = await post(resolve, '/api/admin/reports', { id: 1, action: 'episode', suggestion: '椒鹽肥腸', alsoSummary: true });
    expect(res.status).toBe(200);
    expect(transcriptEdits()).toHaveLength(2);
    expect(summaryEdits()).toEqual([{ old_text: '交言肥腸', new_text: '椒鹽肥腸', report_id: 1 }]);
  });

  it('decides a report once: a second decision changes nothing', async () => {
    const r = getReport(db, 1)!;
    expect(resolveReport(db, r, 'rejected', r.suggestion)).toBe(true);
    // The identical report was closed with it; deciding the first again does nothing
    expect(resolveReport(db, r, 'accepted', '別的')).toBe(false);
    expect(reports().map((x) => x.status)).toEqual(['rejected', 'rejected']);
    expect((await post(resolve, '/api/admin/reports', { id: 1, action: 'here', suggestion: '椒鹽肥腸' })).status).toBe(409);
    expect(transcriptEdits()).toEqual([]);
  });

  it('still rejects a report whose episode is no longer on the site', async () => {
    db.prepare(`UPDATE episodes SET status = 'failed' WHERE id = ?`).run(epId);
    expect((await post(resolve, '/api/admin/reports', { id: 1, action: 'here', suggestion: '椒鹽肥腸' })).status).toBe(409);
    expect((await post(resolve, '/api/admin/reports', { id: 1, action: 'reject', suggestion: '' })).status).toBe(200);
  });

  it('uses the suggestion as the admin changed it, and rejects', async () => {
    await post(resolve, '/api/admin/reports', { id: 1, action: 'here', suggestion: '椒鹽大腸' });
    expect(transcriptEdits()[0]).toMatchObject({ new_text: '今天吃椒鹽大腸' });
    expect(reports()[0]).toMatchObject({ suggestion: '椒鹽大腸' });
    signIn('u3');
    await post(report, '/api/report', { ...transcriptReport, suggestion: '別的' });
    signIn('admin');
    await post(resolve, '/api/admin/reports', { id: 3, action: 'reject', suggestion: '' });
    expect(reports()[2]).toMatchObject({ status: 'rejected' });
  });
});

// ── worker ─────────────────────────────────────────────────────────────────────

describe('summary edits in the worker', () => {
  const insert = (oldText: string, newText: string) =>
    db.prepare('INSERT INTO summary_edits (episode_id, old_text, new_text) VALUES (?, ?, ?)').run(epId, oldText, newText);
  const row = () => db.prepare('SELECT summary_json FROM episodes WHERE id = ?').get(epId) as { summary_json: string };

  it('fixes the summary, the mentions made from it and its summary points, leaving the transcript', async () => {
    const chunks = db.prepare('SELECT id, text FROM chunks ORDER BY id').all();
    insert('交言肥腸', '椒鹽肥腸');
    expect(await applyPendingEdits(db, 709)).toEqual({ done: 1, missing: 0 });
    expect((JSON.parse(row().summary_json) as Summary).line).toBe('聊到椒鹽肥腸和輝達');
    expect(db.prepare('SELECT name, quote FROM mentions WHERE category = ?').get('美食')).toEqual({ name: '椒鹽肥腸', quote: '椒鹽肥腸超讚' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM summary_points WHERE text LIKE ?').get('%椒鹽肥腸%')).toEqual({ n: 2 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM summary_points_vec').get()).toEqual(db.prepare('SELECT COUNT(*) AS n FROM summary_points').get());
    expect(db.prepare('SELECT id, text FROM chunks ORDER BY id').all()).toEqual(chunks);
    expect(mocks.notify.mock.calls[0]![0]).toContain('EP709 重點修正 5 處');
  });

  it('marks one whose words are gone as failed', async () => {
    insert('不存在的字', '別的字');
    await applyPendingEdits(db, 709);
    expect(db.prepare('SELECT applied_at, error FROM summary_edits').get()).toEqual({ applied_at: null, error: '重點裡找不到要改的原文' });
    expect(mocks.embed).not.toHaveBeenCalled();
  });

  it('puts applied ones into a summary draft that was waiting, when it is published', async () => {
    // A re-run failed at the embed step: its draft waits, the live summary stays
    db.prepare(`UPDATE episodes SET summary_draft_json = ?, failed_step = 'embed' WHERE id = ?`).run(
      JSON.stringify({ ...summary, line: '草稿：交言肥腸' }),
      epId,
    );
    insert('交言肥腸', '椒鹽肥腸');
    await applyPendingEdits(db, 709);
    await processEpisode(db, getEpisode(db, 709)!);
    expect((JSON.parse(row().summary_json) as Summary).line).toBe('草稿：椒鹽肥腸');
  });

  it('puts applied ones back after a re-summary', async () => {
    insert('交言肥腸', '椒鹽肥腸');
    await applyPendingEdits(db, 709);
    mocks.notify.mockClear();
    mocks.summarize.mockResolvedValue({ summary: { ...summary, line: '新的一句：交言肥腸' }, costUsd: 0.3 });
    await processEpisode(db, getEpisode(db, 709)!, { redoFrom: 'summarize' });
    expect((JSON.parse(row().summary_json) as Summary).line).toBe('新的一句：椒鹽肥腸');
    expect(mocks.notify.mock.calls[0]![0]).toContain('套回 5 處重點修正');
  });
});

describe('report notifications and purge', () => {
  it('tells Telegram about new reports once', async () => {
    signIn('u1');
    await post(report, '/api/report', { ...transcriptReport, note: '這是一家店' });
    expect(await notifyReports(db)).toBe(1);
    expect(mocks.notify.mock.calls[0]![0]).toContain('EP709 逐字稿 0:00「交言肥腸」→「椒鹽肥腸」（這是一家店）');
    expect(await notifyReports(db)).toBe(0);
  });

  it('leaves reports unmarked when Telegram did not take the message', async () => {
    signIn('u1');
    await post(report, '/api/report', transcriptReport);
    mocks.notify.mockResolvedValueOnce(false);
    expect(await notifyReports(db)).toBe(0);
    expect(await notifyReports(db)).toBe(1);
  });

  it("forgets reporters after ASK_LOG_DAYS, and backups never carry them", async () => {
    signIn('u1');
    await post(report, '/api/report', transcriptReport);
    expect(purgeReporters(db)).toBe(0);
    db.prepare(`UPDATE typo_reports SET created_at = '2020-01-01T00:00:00Z'`).run();
    expect(purgeReporters(db)).toBe(1);
    expect(reports()[0]).toMatchObject({ user_id: null });

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reports-'));
    const file = path.join(dir, 'copy.db');
    const live = openDb(file);
    live.prepare(`INSERT INTO episodes (episode_no, guid, title, published_at, audio_url) VALUES (1, 'g', 't', '2026-01-01', 'u')`).run();
    live.prepare(`INSERT INTO typo_reports (episode_id, target, original, suggestion, user_id) VALUES (1, 'summary', 'a', 'b', 'secret-user')`).run();
    live.close();
    stripAskLog(file);
    expect(fs.readFileSync(file).includes('secret-user')).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
