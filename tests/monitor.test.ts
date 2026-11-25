import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '@/lib/db.ts';
import { episodeCountDrop, verifyBackup } from '../worker/backup.ts';
import { diskWarning, MAX_JOB_MS, ping, queueHealthy, startupMessage } from '../worker/monitor.ts';

// Backups are files, so these tests need real ones; everything is closed and removed after each test
const dirs: string[] = [];
const dbs: ReturnType<typeof openDb>[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const db of dbs.splice(0)) db.close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gooaye-'));
  dirs.push(dir);
  return dir;
}

function open(file = ':memory:'): ReturnType<typeof openDb> {
  const db = openDb(file);
  dbs.push(db);
  return db;
}

function addEpisode(db: ReturnType<typeof openDb>, no: number, status: string): void {
  db.prepare(
    `INSERT INTO episodes (episode_no, guid, title, published_at, audio_url, status)
     VALUES (?, ?, 't', '2026-10-29T00:00:00Z', 'https://example.com/a.mp3', ?)`,
  ).run(no, `g${no}`, status);
}

describe('ping', () => {
  it('does nothing without a URL', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await ping(undefined);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pings the URL on success and /fail with a reason on failure', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response('OK'));
    vi.stubGlobal('fetch', fetchMock);
    await ping('https://hc-ping.com/abc');
    await ping('https://hc-ping.com/abc', 'fail', 'backup broke');
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['https://hc-ping.com/abc', 'https://hc-ping.com/abc/fail']);
    expect(fetchMock.mock.calls[1]![1].body).toBe('backup broke');
  });

  it('never throws when the ping fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(ping('https://hc-ping.com/abc')).resolves.toBeUndefined();
  });
});

describe('queueHealthy', () => {
  const now = Date.parse('2026-11-04T06:00:00Z');

  it('is healthy when idle or while a job is within the limit', () => {
    expect(queueHealthy(null, now)).toBe(true);
    expect(queueHealthy(now - 20 * 60_000, now)).toBe(true);
  });

  it('stops the heartbeat once a job runs past the limit', () => {
    expect(queueHealthy(now - MAX_JOB_MS - 1, now)).toBe(false);
  });
});

describe('startupMessage', () => {
  const queueFile = (content?: string) => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gooaye-')), 'app.db.queue.json');
    if (content !== undefined) fs.writeFileSync(f, content);
    return f;
  };

  it('is the plain message after an idle stop (a deploy) or on a first start', () => {
    expect(startupMessage(queueFile('{"running":null,"since":null,"waiting":0}'))).toBe('🔄 worker 已啟動');
    expect(startupMessage(queueFile())).toBe('🔄 worker 已啟動');
    expect(startupMessage(queueFile('{"runn'))).toBe('🔄 worker 已啟動');
    // Valid JSON of another shape must not stop the worker from starting
    for (const odd of ['null', '[]', '3', '{"running":5}']) expect(startupMessage(queueFile(odd))).toBe('🔄 worker 已啟動');
  });

  it('names the job the previous process was killed in, in Taipei time', () => {
    const msg = startupMessage(queueFile('{"running":"每晚清理與備份","since":"2026-11-24T19:00:00.004Z","waiting":0}'));
    expect(msg).toMatch(/^⚠️ worker 重新啟動/);
    expect(msg).toContain('「每晚清理與備份」（2026-11-25 03:00 開始）時中斷');
  });

  it('leaves out a start time it cannot read', () => {
    expect(startupMessage(queueFile('{"running":"檢查 RSS","since":null,"waiting":2}'))).toContain('「檢查 RSS」時中斷');
  });
});

describe('diskWarning', () => {
  // 47 GB disk like the VPS, in 1 MB blocks
  const statfs = (freeGb: number, totalGb = 47) =>
    vi.spyOn(fs, 'statfsSync').mockReturnValue({ bavail: freeGb * 1000, blocks: totalGb * 1000, bsize: 1e6 } as fs.StatsFs);

  it('stays quiet with enough free space', () => {
    statfs(33);
    expect(diskWarning('/data')).toBeNull();
  });

  it('warns below 15% and 10 GB free', () => {
    statfs(5);
    expect(diskWarning('/data')).toBe('磁碟只剩 11%（5.0 GB）');
  });

  it('stays quiet on a large disk with a low ratio but many gigabytes left', () => {
    statfs(50, 500);
    expect(diskWarning('/data')).toBeNull();
  });
});

describe('episodeCountDrop', () => {
  it('reports a drop every night until the state file is reset', () => {
    const db = open();
    const state = path.join(tmp(), 'app.db.backup-state.json');
    addEpisode(db, 1, 'done');
    addEpisode(db, 2, 'done');
    addEpisode(db, 3, 'failed');
    expect(episodeCountDrop(db, state)).toBeNull();

    addEpisode(db, 4, 'done');
    expect(episodeCountDrop(db, state)).toBeNull();

    db.prepare('DELETE FROM episodes WHERE episode_no IN (1, 2)').run();
    expect(episodeCountDrop(db, state)).toMatch(/^已上線集數從 3 變成 1/);
    // The high-water count is kept, so the next night still reports it
    expect(episodeCountDrop(db, state)).toMatch(/^已上線集數從 3 變成 1/);

    fs.rmSync(state);
    expect(episodeCountDrop(db, state)).toBeNull();
  });
});

describe('verifyBackup', () => {
  it('passes a healthy copy and counts live episodes', async () => {
    const dir = tmp();
    const db = open(path.join(dir, 'app.db'));
    addEpisode(db, 1, 'done');
    addEpisode(db, 2, 'pending');
    await db.backup(path.join(dir, 'copy.db'));
    expect(verifyBackup(path.join(dir, 'copy.db'))).toEqual({ episodes: 1 });
  });

  it('rejects a corrupt copy', async () => {
    const dir = tmp();
    const db = open(path.join(dir, 'app.db'));
    for (let i = 1; i <= 50; i++) addEpisode(db, i, 'done');
    const copy = path.join(dir, 'copy.db');
    await db.backup(copy);
    // Overwrite a few pages past the header with garbage
    const fd = fs.openSync(copy, 'r+');
    fs.writeSync(fd, Buffer.alloc(3 * 4096, 0xab), 0, 3 * 4096, 2 * 4096);
    fs.closeSync(fd);
    expect(fs.statSync(copy).size).toBeGreaterThan(5 * 4096);
    expect(() => verifyBackup(copy)).toThrow(/integrity_check|malformed/);
  });
});
