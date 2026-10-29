import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { AwsClient } from 'aws4fetch';
import type { DB } from '@/lib/db.ts';
import { WORK_DIR } from './config.ts';

// Nightly copy of app.db to Cloudflare R2. Old copies are removed by a 30-day
// lifecycle rule on the bucket, so this only ever writes.
export async function backupToR2(db: DB, now = new Date()): Promise<string | null> {
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
    fs.rmSync(file, { force: true });
  }
}
