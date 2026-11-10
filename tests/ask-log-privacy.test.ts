import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { type DB, openDb } from '@/lib/db.ts';
import { stripAskLog } from '../worker/backup.ts';
import { compactDb, purgeAskLog } from '../worker/stats.ts';

// /about promises questions and answers are gone after ASK_LOG_DAYS, from the live
// database and from backups. "Gone" means the text, not just the rows: these tests read
// the raw files, where a DELETE leaves it in free pages and in stale copies that page
// splits made while the rows were inserted.

const QUESTION = 'secret-question-7f3a9c';
const ANSWER = 'secret-answer-b81d24';

function tempDb(): { db: DB; file: string } {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gooaye-')), 'app.db');
  return { db: openDb(file), file };
}

// Enough rows to split pages, answers long enough for overflow pages, and one recent row
// that stays (with the table never empty, its root page is rebalanced rather than cleared)
function fill(db: DB): void {
  const insert = db.prepare(`INSERT INTO ask_log (user_id, question, answer, created_at) VALUES ('u', ?, ?, '2020-01-01T00:00:00Z')`);
  for (let i = 0; i < 100; i++) insert.run(`${QUESTION} ${i}`, `${ANSWER} ${i} `.repeat(400));
  db.prepare(`INSERT INTO ask_log (user_id, question) VALUES ('u', 'recent-question-kept')`).run();
  db.prepare(`INSERT INTO worker_state (key, value) VALUES ('kept', 'yes')`).run();
}

function onDisk(file: string, text: string): boolean {
  return [file, `${file}-wal`, `${file}-journal`].some((f) => fs.existsSync(f) && fs.readFileSync(f).includes(text));
}

describe('nightly purge on the live database', () => {
  it('leaves no text of purged rows in app.db or app.db-wal', () => {
    const { db, file } = tempDb();
    fill(db);
    expect(onDisk(file, QUESTION)).toBe(true);

    expect(purgeAskLog(db)).toBe(100);
    expect(compactDb(db)).toBe(true);

    expect(onDisk(file, QUESTION)).toBe(false);
    expect(onDisk(file, ANSWER)).toBe(false);
    expect(fs.statSync(`${file}-wal`).size).toBe(0);
    expect(db.prepare('SELECT question FROM ask_log').all()).toEqual([{ question: 'recent-question-kept' }]);
    db.close();
  });

  // What compactDb is for: if this ever passes without it, the VACUUM could go
  it('needs the VACUUM: after the DELETE alone the text is still in the file', () => {
    const { db, file } = tempDb();
    fill(db);
    purgeAskLog(db);
    db.pragma('wal_checkpoint(TRUNCATE)');
    expect(onDisk(file, QUESTION)).toBe(true);
    db.close();
  });
});

describe('stripAskLog', () => {
  it('leaves a backup copy with no ask_log text and everything else intact', async () => {
    const { db, file } = tempDb();
    fill(db);
    const copy = path.join(path.dirname(file), 'backup.db');
    await db.backup(copy);
    db.close();

    stripAskLog(copy);

    expect(onDisk(copy, QUESTION)).toBe(false);
    expect(onDisk(copy, ANSWER)).toBe(false);
    expect(onDisk(copy, 'recent-question-kept')).toBe(false);
    const restored = openDb(copy, { readonly: true });
    expect(restored.prepare('SELECT COUNT(*) AS n FROM ask_log').get()).toEqual({ n: 0 });
    expect(restored.prepare(`SELECT value FROM worker_state WHERE key = 'kept'`).get()).toEqual({ value: 'yes' });
    restored.close();
  });
});
