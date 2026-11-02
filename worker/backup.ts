import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { AwsClient } from 'aws4fetch';
import { countLiveEpisodes, type DB, openDb } from '@/lib/db.ts';
import { isProduction } from '@/lib/env.ts';
import { WORK_DIR } from './config.ts';

// Nightly copy of app.db to Cloudflare R2. Old copies are removed by a 30-day
// lifecycle rule on the bucket, so this only ever writes.
export async function backupToR2(db: DB, now = new Date()): Promise<string | null> {
  // A local database must never overwrite the live site's backup for the day
  if (!isProduction()) {
    console.log('backup: only runs with APP_ENV=production, skipping');
    return null;
  }
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    console.log('backup: R2 is not configured, skipping');
    return null;
  }
  fs.mkdirSync(WORK_DIR, { recursive: true });
  const file = path.join(WORK_DIR, 'backup.db');
  try {
    // Online backup: consistent even while web is writing ask_usage
    await db.backup(file);
    verifyBackup(file);
    const body = await promisify(gzip)(fs.readFileSync(file));
    const key = `backups/app-${now.toISOString().slice(0, 10)}.db.gz`;
    const r2 = new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, service: 's3', region: 'auto' });
    const res = await r2.fetch(`https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${key}`, {
      method: 'PUT',
      body,
      headers: { 'Content-Type': 'application/gzip' },
    });
    if (!res.ok) throw new Error(`R2 ${res.status}: ${(await res.text()).slice(0, 300)}`);
    console.log(`backup: uploaded ${key} (${(body.length / 1e6).toFixed(1)} MB)`);
    return key;
  } finally {
    // The copy is in WAL mode, so opening it can leave sidecar files behind
    for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
  }
}

// A corrupt copy is worse than none: it looks like a backup until the day it's needed.
// Opened through openDb so the vec0 tables' module is loaded for the check.
export function verifyBackup(file: string): { episodes: number } {
  const db = openDb(file, { readonly: true });
  try {
    const result = (db.pragma('integrity_check') as { integrity_check: string }[]).map((r) => r.integrity_check).join('; ');
    if (result !== 'ok') throw new Error(`integrity_check: ${result.slice(0, 300)}`);
    return { episodes: countLiveEpisodes(db) };
  } finally {
    db.close();
  }
}

// Live episodes never go away on their own; a drop means data was lost, and the
// nightly backups would quietly carry the loss forward while the 30-day lifecycle
// deletes the good ones. The highest count seen is kept in a file next to the
// database and only ever rises, so a drop is reported every night until it's
// fixed. After removing episodes on purpose, delete the file to reset it.
export function episodeCountDrop(db: DB, stateFile: string): string | null {
  const now = countLiveEpisodes(db);
  let best: number | null = null;
  try {
    best = (JSON.parse(fs.readFileSync(stateFile, 'utf8')) as { episodes: number }).episodes;
  } catch {
    // First run, or the file was removed: nothing to compare against yet
  }
  if (best !== null && now < best) return `已上線集數從 ${best} 變成 ${now}（刪掉 ${path.basename(stateFile)} 可重設）`;
  fs.writeFileSync(stateFile, JSON.stringify({ episodes: now, at: new Date().toISOString() }));
  return null;
}
