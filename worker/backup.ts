import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { AwsClient } from 'aws4fetch';
import { countLiveEpisodes, type DB, hasTable, openDb } from '@/lib/db.ts';
import { ADDRESS_SQL, ANON_SQL } from '@/lib/ask/anon.ts';
import { isProduction } from '@/lib/env.ts';
import { WORK_DIR } from './config.ts';

const BACKUP_FILE = path.join(WORK_DIR, 'backup.db');
// The copy, the sidecars opening it can leave behind, and the gzipped upload
const BACKUP_FILES = ['', '-wal', '-shm', '-journal', '.gz'].map((s) => BACKUP_FILE + s);

// Until stripAskLog finishes the copy holds every question, so it must not outlive the run.
// backupToR2's finally covers errors but not the process being killed (the out-of-memory
// kill of 2026-11-25 left a full copy in the container), so the worker also calls this
// when it starts.
export function removeBackupFiles(): void {
  for (const f of BACKUP_FILES) fs.rmSync(f, { force: true });
}

// Nightly copy of app.db to Cloudflare R2. Old copies are removed by a 30-day
// lifecycle rule on the bucket, so this only ever writes.
// Everything streams through files: the database is past 500 MB and the worker's container
// is capped at 768 MiB, so reading the copy into memory to gzip it got the worker killed.
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
  const file = BACKUP_FILE;
  const gz = `${file}.gz`;
  try {
    // A killed run's copy would otherwise be the destination of the backup below
    removeBackupFiles();
    // Online backup: consistent even while web is writing ask_usage
    await db.backup(file);
    stripAskLog(file);
    verifyBackup(file);
    await pipeline(fs.createReadStream(file), createGzip(), fs.createWriteStream(gz));
    fs.rmSync(file, { force: true });
    const key = `backups/app-${now.toISOString().slice(0, 10)}.db.gz`;
    const r2 = new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, service: 's3', region: 'auto' });
    const size = await putFile(r2, `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${key}`, gz);
    console.log(`backup: uploaded ${key} (${(size / 1e6).toFixed(1)} MB)`);
    return key;
  } finally {
    removeBackupFiles();
  }
}

const UPLOAD_ATTEMPTS = 3;

class UploadRefused extends Error {}

// PUTs a file as a stream, signed with its SHA-256 (with that header set, aws4fetch never
// reads the body to hash it). Not r2.fetch: it retries with the same body, and a stream can
// only be sent once, so each attempt opens the file again. Returns the file's size.
export async function putFile(r2: AwsClient, url: string, file: string, retryMs = 5000): Promise<number> {
  const size = fs.statSync(file).size;
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer);
  const sha256 = hash.digest('hex');
  for (let attempt = 1; ; attempt++) {
    let failure: string;
    const stream = fs.createReadStream(file);
    try {
      const req = await r2.sign(url, {
        method: 'PUT',
        body: Readable.toWeb(stream) as ReadableStream,
        // R2 needs a length, which a stream body doesn't carry
        headers: { 'Content-Type': 'application/gzip', 'Content-Length': String(size), 'X-Amz-Content-Sha256': sha256 },
      });
      const res = await fetch(req);
      if (res.ok) return size;
      const text = await res.text().catch(() => '');
      failure = `R2 ${res.status}: ${text.slice(0, 300)}`;
      // A refusal (credentials, bucket) won't change on a retry; a slow upload's timeout might
      if (res.status < 500 && res.status !== 429 && !text.includes('RequestTimeout')) throw new UploadRefused(failure);
    } catch (err) {
      if (err instanceof UploadRefused) throw err;
      failure = err instanceof Error ? err.message : String(err);
    } finally {
      // An attempt that failed mid-way leaves its descriptor open otherwise
      stream.destroy();
    }
    if (attempt >= UPLOAD_ATTEMPTS) throw new Error(failure);
    console.error(`backup: upload attempt ${attempt} failed (${failure}), retrying`);
    await new Promise((r) => setTimeout(r, retryMs * attempt));
  }
}

// /about and /ask promise questions and answers are gone after ASK_LOG_DAYS, but R2 keeps
// each backup another 30 days, so backups carry no ask_log rows at all (a restore starts
// with an empty log; ask_daily keeps the totals). The DELETE alone would leave the text in
// the file (see compactDb in stats.ts); VACUUM rebuilds it from the remaining rows. The copy
// is thrown away on failure, so it runs without a journal: nothing to roll back to, and no
// -journal file holding the deleted rows.
export function stripAskLog(file: string): void {
  const db = openDb(file, { migrate: false });
  try {
    db.pragma('journal_mode = OFF');
    db.exec('DELETE FROM ask_log');
    // ask_log ids start over in a restore, so a kept row would block a new question's 擴大搜尋
    if (hasTable(db, 'ask_retries')) db.exec('DELETE FROM ask_retries');
    // Nor the day's counts of visitors without a login and their networks (anon.ts): an
    // address key is an HMAC of an address, kept USAGE_KEPT_DAYS live and nowhere else
    db.exec(`DELETE FROM ask_usage WHERE ${ANON_SQL()} OR ${ADDRESS_SQL()}`);
    // Nor who sent a typo report (kept ASK_LOG_DAYS on the live database, like a question)
    if (db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'typo_reports'`).get()) db.exec('UPDATE typo_reports SET user_id = NULL');
    // Nor who sent feedback, or their email (kept FEEDBACK_KEEP_DAYS on the live database)
    if (hasTable(db, 'feedback')) db.exec('UPDATE feedback SET user_id = NULL, email = NULL');
    db.exec('VACUUM');
  } finally {
    db.close();
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
