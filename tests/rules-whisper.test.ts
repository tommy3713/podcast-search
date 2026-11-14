import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DB, EMBEDDING_DIM, openDb } from '@/lib/db.ts';
import type { Segment } from '@/lib/segments.ts';
import type { Summary } from '@/lib/summary.ts';

const mocks = vi.hoisted(() => ({
  transcribe: vi.fn(),
  summarize: vi.fn(),
  embed: vi.fn(),
  notify: vi.fn(),
  session: vi.fn(),
  db: undefined as unknown,
}));
vi.mock('../worker/audio.ts', () => ({ download: vi.fn(), compress: vi.fn(async () => ({ parts: [], duration: 100 })) }));
vi.mock('../worker/seek-table.ts', () => ({ seekTableOfFile: vi.fn(async () => null) }));
vi.mock('../worker/transcribe.ts', () => ({ transcribe: mocks.transcribe }));
vi.mock('../worker/summarize.ts', () => ({ summarize: mocks.summarize }));
vi.mock('../worker/embed.ts', () => ({ embed: mocks.embed }));
vi.mock('../worker/notify.ts', () => ({ notify: mocks.notify }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/lib/server-db.ts', () => ({ readDb: async () => mocks.db, writeDb: async () => mocks.db }));

const { processEpisode } = await import('../worker/pipeline.ts');
const { getEpisode, insertDiscovered, publishEpisode, transcriptionSettings } = await import('../worker/repo.ts');
const { chunkSegments, summaryPoints } = await import('../worker/chunk.ts');
const { WHISPER_PROMPT } = await import('@/lib/whisper/default-prompt.ts');
const { whisperTokens, WHISPER_PROMPT_TOKENS } = await import('@/lib/whisper/tokens.ts');
const { promptVersions } = await import('@/lib/whisper/prompts.ts');
const { applyRule, checkRule, previewRule, saveRule } = await import('@/lib/rules.ts');
const { POST: whisperApi } = await import('@/app/api/admin/whisper/route.ts');
const { POST: rulesApi } = await import('@/app/api/admin/rules/route.ts');

const seg = (start: number, text: string): Segment => ({ start, end: start + 4, text });
const summary: Summary = {
  line: '聊台積和台積電',
  keys: [],
  chapters: [{ t: 0, title: '開場', ad: false, bullets: [{ t: 0, text: '台積法說' }], quote: null }],
  stocks: [],
  mentions: [],
};
const vector = () => Array(EMBEDDING_DIM).fill(0.1);

let db: DB;
const addLive = (no: number, segments: Segment[]) => {
  insertDiscovered(db, { guid: `g${no}`, episodeNo: no, title: `t${no}`, publishedAt: '2026-10-31T07:00:00.000Z', audioUrl: `https://x/${no}.mp3`, duration: 100 });
  const id = getEpisode(db, no)!.id;
  db.prepare('UPDATE episodes SET segments_json = ?, duration = 100 WHERE id = ?').run(JSON.stringify(segments), id);
  const chunks = chunkSegments(segments);
  const points = summaryPoints(summary);
  publishEpisode(db, id, { summary, chunks, vectors: chunks.map(vector), points, pointVectors: points.map(vector), costUsd: 0 });
  return id;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  db = openDb(':memory:');
  mocks.db = db;
  mocks.embed.mockImplementation(async (texts: string[]) => ({ vectors: texts.map(vector), costUsd: 0.0001 }));
  mocks.summarize.mockResolvedValue({ summary, costUsd: 0.3 });
});

const post = (fn: (r: Request) => Promise<Response>, url: string, body: unknown) =>
  fn(new Request(`http://localhost${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const asAdmin = () => {
  vi.stubEnv('ADMIN_USER_ID', 'admin');
  mocks.session.mockResolvedValue({ user: { id: 'admin', name: 'me' } });
};

describe('what a transcription uses', () => {
  it('starts with the built-in prompt and the mishearings that were hardcoded', () => {
    const s = transcriptionSettings(db);
    expect(s).toMatchObject({ promptId: null, prompt: WHISPER_PROMPT });
    expect(s.rules).toEqual(expect.arrayContaining([['聖風宮', '謝孟恭'], ['谷海', '股癌'], ['古愛', '股癌']]));
    expect(s.rules).toHaveLength(5);
  });

  it('takes the newest prompt and the enabled rules, longest first', () => {
    db.prepare(`INSERT INTO whisper_prompts (text) VALUES ('一'), ('二')`).run();
    saveRule(db, { original: '交言肥腸', replacement: '椒鹽肥腸', note: null, enabled: true });
    saveRule(db, { original: '谷海', replacement: '股癌', note: null, enabled: false });
    const s = transcriptionSettings(db);
    expect(s).toMatchObject({ promptId: 2, prompt: '二' });
    expect(s.rules[0]).toEqual(['交言肥腸', '椒鹽肥腸']);
    expect(s.rules.some(([o]) => o === '谷海')).toBe(false);
  });

  it('passes them to the transcription and records the prompt on the episode', async () => {
    db.prepare(`INSERT INTO whisper_prompts (text) VALUES ('新的提示詞')`).run();
    insertDiscovered(db, { guid: 'g1', episodeNo: 1, title: 't', publishedAt: '2026-10-31T07:00:00.000Z', audioUrl: 'https://x/1.mp3', duration: 100 });
    mocks.transcribe.mockResolvedValue({ segments: [seg(0, '開場')], billedSeconds: 100 });
    await processEpisode(db, getEpisode(db, 1)!);
    expect(mocks.transcribe.mock.calls[0]![1]).toMatchObject({ prompt: '新的提示詞', rules: expect.arrayContaining([['谷海', '股癌']]) });
    expect(db.prepare('SELECT whisper_prompt_id FROM episodes WHERE episode_no = 1').get()).toEqual({ whisper_prompt_id: 1 });
  });
});

describe('Whisper prompt', () => {
  it("counts tokens with Whisper's vocabulary (checked against tiktoken)", () => {
    expect(whisperTokens('hello world')).toBe(2);
    expect(whisperTokens('歡迎收聽股癌，我是謝孟恭。')).toBe(17);
    expect(whisperTokens(WHISPER_PROMPT)).toBe(90);
    expect(whisperTokens('  多個   空白\n換行 😀 emoji')).toBe(14);
  });

  it('saves a new version within the limit, for admins only', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await post(whisperApi, '/api/admin/whisper', { action: 'save', text: '新的' })).status).toBe(404);
    asAdmin();
    const count = await post(whisperApi, '/api/admin/whisper', { action: 'count', text: 'hello world' });
    expect(await count.json()).toEqual({ tokens: 2, limit: WHISPER_PROMPT_TOKENS });
    expect((await post(whisperApi, '/api/admin/whisper', { action: 'save', text: '股'.repeat(400) })).status).toBe(400);
    expect((await post(whisperApi, '/api/admin/whisper', { action: 'save', text: WHISPER_PROMPT })).status).toBe(400);
    expect((await post(whisperApi, '/api/admin/whisper', { action: 'save', text: '歡迎收聽股癌，  今天聊椒鹽肥腸。' })).status).toBe(200);
    const versions = promptVersions(db);
    expect(versions[0]).toMatchObject({ id: 1, text: '歡迎收聽股癌， 今天聊椒鹽肥腸。', current: true });
    expect(versions.at(-1)).toMatchObject({ id: null, current: false });
  });
});

describe('rules', () => {
  it('checks the words', () => {
    expect(checkRule('谷海', '股癌')).toBeNull();
    expect(checkRule('谷', '股')).not.toBeNull();
    expect(checkRule('谷海', '谷海')).not.toBeNull();
    expect(checkRule('谷海', '')).not.toBeNull();
  });

  it('previews every live episode it would change, leaving words already right', () => {
    addLive(1, [seg(0, '台積和台積電'), seg(5, '別的')]);
    addLive(2, [seg(0, '沒有這個詞')]);
    addLive(3, [seg(0, '台積法說會')]);
    const p = previewRule(db, '台積', '台積電');
    // Episode 2's summary has 台積 too (the shared fixture), so it is listed for its summary
    expect(p.map((e) => [e.no, e.count, e.summaryCount])).toEqual([
      [3, 1, 2],
      [2, 0, 2],
      [1, 1, 2],
    ]);
    expect(p[2]!.samples).toEqual([{ start: 0, text: '台積和台積電' }]);
  });

  it('applies a rule to the chosen episodes as edits the worker applies', () => {
    const a = addLive(1, [seg(0, '台積和台積電')]);
    addLive(2, [seg(0, '台積法說會')]);
    const id = saveRule(db, { original: '台積', replacement: '台積電', note: null, enabled: true })!;
    expect(applyRule(db, { id, original: '台積', replacement: '台積電' }, [1], true)).toEqual({ episodes: 1, segments: 1, summary: 2 });
    expect(db.prepare('SELECT episode_id, new_text, fix_id FROM transcript_edits').all()).toEqual([{ episode_id: a, new_text: '台積電和台積電', fix_id: id }]);
    expect(db.prepare('SELECT episode_id, old_text, new_text, fix_id FROM summary_edits').all()).toEqual([
      { episode_id: a, old_text: '台積', new_text: '台積電', fix_id: id },
    ]);
  });

  it('saves, applies and toggles through the API, for admins only', async () => {
    addLive(1, [seg(0, '交言肥腸')]);
    mocks.session.mockResolvedValue({ user: { id: 'someone', name: 'x' } });
    vi.stubEnv('ADMIN_USER_ID', 'admin');
    expect((await post(rulesApi, '/api/admin/rules', { action: 'preview', original: '交言肥腸', replacement: '椒鹽肥腸' })).status).toBe(404);
    asAdmin();
    const preview = await (await post(rulesApi, '/api/admin/rules', { action: 'preview', original: '交言肥腸', replacement: '椒鹽肥腸' })).json();
    expect(preview.episodes.map((e: { no: number }) => e.no)).toEqual([1]);
    const saved = await post(rulesApi, '/api/admin/rules', {
      action: 'save',
      original: '交言肥腸',
      replacement: '椒鹽肥腸',
      note: '一道菜',
      enabled: true,
      episodes: [1],
      summary: false,
    });
    expect(await saved.json()).toMatchObject({ ok: true, applied: { episodes: 1, segments: 1, summary: 0 } });
    const rule = db.prepare(`SELECT id, enabled FROM text_fixes WHERE original = '交言肥腸'`).get() as { id: number; enabled: number };
    expect(rule.enabled).toBe(1);
    expect((await post(rulesApi, '/api/admin/rules', { action: 'enable', id: rule.id, enabled: false })).status).toBe(200);
    expect(transcriptionSettings(db).rules.some(([o]) => o === '交言肥腸')).toBe(false);
    expect((await post(rulesApi, '/api/admin/rules', { action: 'save', original: '谷', replacement: '股', enabled: true, episodes: [], summary: false })).status).toBe(400);
  });
});

describe('editing rules', () => {
  it("changes an existing rule's words instead of adding another, and deletes", async () => {
    asAdmin();
    const typo = db.prepare(`SELECT id FROM text_fixes WHERE original = '沈夢恭'`).get() as { id: number };
    const save = (body: Record<string, unknown>) =>
      post(rulesApi, '/api/admin/rules', { action: 'save', replacement: '謝孟恭', enabled: true, episodes: [], summary: false, ...body });
    expect((await save({ id: typo.id, original: '沈孟恭' })).status).toBe(200);
    const rules = transcriptionSettings(db).rules.map(([o]) => o);
    expect(rules).toContain('沈孟恭');
    expect(rules).not.toContain('沈夢恭');
    expect(rules).toHaveLength(5);
    // Words another rule has already: refused
    expect((await save({ id: typo.id, original: '謝夢恭' })).status).toBe(409);
    expect((await post(rulesApi, '/api/admin/rules', { action: 'delete', id: typo.id })).status).toBe(200);
    expect(transcriptionSettings(db).rules).toHaveLength(4);
  });

  it("records no prompt for a transcript that wasn't transcribed here (--segments-file)", async () => {
    addLive(1, [seg(0, '開場')]);
    db.prepare('UPDATE episodes SET whisper_prompt_id = 7 WHERE episode_no = 1').run();
    await processEpisode(db, getEpisode(db, 1)!, { redoFrom: 'transcribe', segments: [seg(0, '別的')] });
    expect(db.prepare('SELECT whisper_prompt_id FROM episodes WHERE episode_no = 1').get()).toEqual({ whisper_prompt_id: null });
  });
});
