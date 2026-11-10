import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '@/lib/db.ts';
import { backupToR2, stripAskLog } from '../worker/backup.ts';
import { WORK_DIR } from '../worker/config.ts';

const env = { R2_ACCOUNT_ID: 'acct', R2_ACCESS_KEY_ID: 'id', R2_SECRET_ACCESS_KEY: 'secret', R2_BUCKET: 'gooaye-backups' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('backupToR2', () => {
  it('skips when R2 is not configured', async () => {
    vi.stubEnv('APP_ENV', 'production');
    for (const k of Object.keys(env)) vi.stubEnv(k, '');
    expect(await backupToR2(openDb(':memory:'))).toBeNull();
  });

  it('skips outside production even when R2 is configured', async () => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    vi.stubEnv('APP_ENV', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await backupToR2(openDb(':memory:'))).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uploads a gzipped, signed copy of the database', async () => {
    vi.stubEnv('APP_ENV', 'production');
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gooaye-'));
    const db = openDb(path.join(dir, 'app.db'));
    db.prepare(`INSERT INTO ask_log (user_id, question) VALUES ('u', 'q')`).run();

    const fetchMock = vi.fn(async (_req: Request) => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const key = await backupToR2(db, new Date('2026-10-29T19:00:00Z'));

    expect(key).toBe('backups/app-2026-10-29.db.gz');
    const req = fetchMock.mock.calls[0]![0] as Request;
    expect(req.method).toBe('PUT');
    expect(req.url).toBe('https://acct.r2.cloudflarestorage.com/gooaye-backups/backups/app-2026-10-29.db.gz');
    expect(req.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=id\//);
    const restored = gunzipSync(Buffer.from(await req.arrayBuffer()));
    expect(restored.subarray(0, 15).toString()).toBe('SQLite format 3');
    // Questions never reach R2 (stripAskLog), while the live database keeps them
    fs.writeFileSync(path.join(dir, 'restored.db'), restored);
    const copy = openDb(path.join(dir, 'restored.db'), { readonly: true });
    expect(copy.prepare('SELECT COUNT(*) AS n FROM ask_log').get()).toEqual({ n: 0 });
    copy.close();
    expect(db.prepare('SELECT COUNT(*) AS n FROM ask_log').get()).toEqual({ n: 1 });
    // Neither copy (the raw one still holds every question) nor any sidecar may outlive the run
    for (const base of ['backup-raw.db', 'backup.db'])
      for (const f of [base, `${base}-wal`, `${base}-shm`, `${base}-journal`]) expect(fs.existsSync(path.join(WORK_DIR, f))).toBe(false);
  });
});

const QUESTION = 'secret-question-7f3a9c';
const ANSWER = 'secret-answer-b81d24';

// Enough rows to fill whole pages, so text left in free pages would show up in the file
function fill(db: ReturnType<typeof openDb>): void {
  const insert = db.prepare(`INSERT INTO ask_log (user_id, question, answer) VALUES ('u', ?, ?)`);
  for (let i = 0; i < 200; i++) insert.run(`${QUESTION} ${i}`, `${ANSWER} ${i}`);
}

describe('stripAskLog', () => {
  it('writes a copy with no question or answer text anywhere in the file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gooaye-'));
    const db = openDb(path.join(dir, 'app.db'));
    fill(db);
    db.prepare(`INSERT INTO worker_state (key, value) VALUES ('kept', 'yes')`).run();
    const raw = path.join(dir, 'raw.db');
    const dest = path.join(dir, 'dest.db');
    await db.backup(raw);
    db.close();

    stripAskLog(raw, dest);

    const bytes = fs.readFileSync(dest);
    expect(bytes.includes(QUESTION)).toBe(false);
    expect(bytes.includes(ANSWER)).toBe(false);
    expect(fs.existsSync(`${raw}-journal`)).toBe(false);
    const copy = openDb(dest, { readonly: true });
    expect(copy.prepare('SELECT COUNT(*) AS n FROM ask_log').get()).toEqual({ n: 0 });
    expect(copy.prepare(`SELECT value FROM worker_state WHERE key = 'kept'`).get()).toEqual({ value: 'yes' });
    copy.close();
  });
});

describe('live database', () => {
  // The nightly purge is a plain DELETE on the worker's connection
  it('overwrites deleted ask_log text instead of leaving it in free pages', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gooaye-')), 'app.db');
    const db = openDb(file);
    fill(db);
    db.pragma('wal_checkpoint(TRUNCATE)');
    expect(fs.readFileSync(file).includes(QUESTION)).toBe(true);

    db.exec('DELETE FROM ask_log');
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    expect(fs.readFileSync(file).includes(QUESTION)).toBe(false);
    expect(fs.readFileSync(file).includes(ANSWER)).toBe(false);
  });
});
