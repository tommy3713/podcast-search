import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '@/lib/db.ts';
import { backupToR2 } from '../worker/backup.ts';

const env = { R2_ACCOUNT_ID: 'acct', R2_ACCESS_KEY_ID: 'id', R2_SECRET_ACCESS_KEY: 'secret', R2_BUCKET: 'gooaye-backups' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('backupToR2', () => {
  it('skips when R2 is not configured', async () => {
    for (const k of Object.keys(env)) vi.stubEnv(k, '');
    expect(await backupToR2(openDb(':memory:'))).toBeNull();
  });

  it('uploads a gzipped, signed copy of the database', async () => {
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
  });
});
