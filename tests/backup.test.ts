import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { AwsClient } from 'aws4fetch';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '@/lib/db.ts';
import { backupToR2, putFile, removeBackupFiles } from '../worker/backup.ts';
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
    const sent = Buffer.from(await req.arrayBuffer());
    // Streamed with its length and signed with its hash: aws4fetch can't hash a stream
    expect(req.headers.get('content-length')).toBe(String(sent.length));
    expect(req.headers.get('x-amz-content-sha256')).toBe(createHash('sha256').update(sent).digest('hex'));
    const restored = gunzipSync(sent);
    expect(restored.subarray(0, 15).toString()).toBe('SQLite format 3');
    // Questions never reach R2 (stripAskLog), while the live database keeps them
    fs.writeFileSync(path.join(dir, 'restored.db'), restored);
    const copy = openDb(path.join(dir, 'restored.db'), { readonly: true });
    expect(copy.prepare('SELECT COUNT(*) AS n FROM ask_log').get()).toEqual({ n: 0 });
    copy.close();
    expect(db.prepare('SELECT COUNT(*) AS n FROM ask_log').get()).toEqual({ n: 1 });
    // Neither the copy nor any sidecar may outlive the run
    for (const f of ['backup.db', 'backup.db-wal', 'backup.db-shm', 'backup.db-journal', 'backup.db.gz']) expect(fs.existsSync(path.join(WORK_DIR, f))).toBe(false);
  });

  it('starts over from the files a killed run left behind', async () => {
    vi.stubEnv('APP_ENV', 'production');
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    fs.mkdirSync(WORK_DIR, { recursive: true });
    for (const f of ['backup.db', 'backup.db-wal', 'backup.db.gz']) fs.writeFileSync(path.join(WORK_DIR, f), 'left by a killed run');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gooaye-'));
    const db = openDb(path.join(dir, 'app.db'));
    const fetchMock = vi.fn(async (_req: Request) => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await backupToR2(db, new Date('2026-10-29T19:00:00Z'));
    const req = fetchMock.mock.calls[0]![0] as Request;
    expect(gunzipSync(Buffer.from(await req.arrayBuffer())).subarray(0, 15).toString()).toBe('SQLite format 3');
  });

  it('reports R2 refusing the upload', async () => {
    vi.stubEnv('APP_ENV', 'production');
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gooaye-'));
    const fetchMock = vi.fn(async (_req: Request) => new Response('AccessDenied', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(backupToR2(openDb(path.join(dir, 'app.db')))).rejects.toThrow('R2 403: AccessDenied');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const f of ['backup.db', 'backup.db.gz']) expect(fs.existsSync(path.join(WORK_DIR, f))).toBe(false);
  });
});

describe('removeBackupFiles', () => {
  it('removes a copy and its sidecars', () => {
    fs.mkdirSync(WORK_DIR, { recursive: true });
    const files = ['backup.db', 'backup.db-wal', 'backup.db-shm', 'backup.db-journal', 'backup.db.gz'].map((f) => path.join(WORK_DIR, f));
    for (const f of files) fs.writeFileSync(f, 'x');
    removeBackupFiles();
    for (const f of files) expect(fs.existsSync(f)).toBe(false);
    removeBackupFiles(); // nothing there: no error
  });
});

describe('putFile', () => {
  const r2 = new AwsClient({ accessKeyId: 'id', secretAccessKey: 'secret', service: 's3', region: 'auto' });
  const file = () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gooaye-')), 'x.gz');
    fs.writeFileSync(f, Buffer.alloc(200_000, 7));
    return f;
  };

  it('retries a server error with the whole file each time', async () => {
    const bodies: number[] = [];
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (req: Request) => {
        bodies.push((await req.arrayBuffer()).byteLength);
        return new Response('', { status: ++calls === 1 ? 503 : 200 });
      }),
    );
    expect(await putFile(r2, 'https://acct.r2.cloudflarestorage.com/b/k', file(), 0)).toBe(200_000);
    expect(bodies).toEqual([200_000, 200_000]);
  });

  it('sends the stream with its length, not chunked, through the real fetch', async () => {
    // R2 refuses an upload without a length; the other tests stub fetch, so check Node's
    const got: { length?: string; chunked?: string; bytes: number }[] = [];
    const server = http.createServer((req, res) => {
      let bytes = 0;
      req.on('data', (c: Buffer) => (bytes += c.length));
      req.on('end', () => {
        got.push({ length: req.headers['content-length'], chunked: req.headers['transfer-encoding'], bytes });
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const { port } = server.address() as AddressInfo;
      expect(await putFile(r2, `http://127.0.0.1:${port}/b/k`, file(), 0)).toBe(200_000);
    } finally {
      server.close();
    }
    expect(got).toEqual([{ length: '200000', chunked: undefined, bytes: 200_000 }]);
  });

  it('retries a request timeout but not another refusal', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(++calls === 1 ? '<Code>RequestTimeout</Code>' : '', { status: calls === 1 ? 400 : 200 })),
    );
    await putFile(r2, 'https://acct.r2.cloudflarestorage.com/b/k', file(), 0);
    expect(calls).toBe(2);
  });

  it('retries a network error and gives up after three attempts', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(putFile(r2, 'https://acct.r2.cloudflarestorage.com/b/k', file(), 0)).rejects.toThrow('fetch failed');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
