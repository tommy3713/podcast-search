import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

export type DB = Database.Database;

export const EMBEDDING_DIM = 1536;

// Each entry upgrades the schema by one version (PRAGMA user_version). Append only.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE episodes (
    id            INTEGER PRIMARY KEY,
    episode_no    INTEGER NOT NULL UNIQUE,
    guid          TEXT    NOT NULL UNIQUE,
    title         TEXT    NOT NULL,
    published_at  TEXT    NOT NULL,              -- ISO 8601, UTC
    audio_url     TEXT    NOT NULL,
    duration      INTEGER,                       -- seconds, from RSS until transcribed
    status        TEXT    NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'transcribing', 'summarizing', 'done', 'failed')),
    error         TEXT,
    retries       INTEGER NOT NULL DEFAULT 0,
    segments_json TEXT,                          -- [{ start, end, text }]
    summary_json  TEXT,                          -- see src/lib/summary.ts
    cost_usd      REAL,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );
  CREATE INDEX episodes_status ON episodes (status, episode_no);

  CREATE TABLE chunks (
    id         INTEGER PRIMARY KEY,
    episode_id INTEGER NOT NULL REFERENCES episodes (id) ON DELETE CASCADE,
    idx        INTEGER NOT NULL,
    start_sec  INTEGER NOT NULL,
    text       TEXT    NOT NULL,
    UNIQUE (episode_id, idx)
  );

  -- Trigram needs queries of 3+ characters; shorter terms fall back to LIKE on chunks.
  CREATE VIRTUAL TABLE chunks_fts USING fts5 (text, content = 'chunks', content_rowid = 'id', tokenize = 'trigram');
  CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
    INSERT INTO chunks_fts (rowid, text) VALUES (new.id, new.text);
  END;
  CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
    INSERT INTO chunks_fts (chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
  END;

  -- rowid = chunks.id. vec0 tables don't cascade, so delete rows here when chunks are deleted.
  CREATE VIRTUAL TABLE chunks_vec USING vec0 (embedding float[${EMBEDDING_DIM}]);

  CREATE TABLE mentions (
    id         INTEGER PRIMARY KEY,
    episode_id INTEGER NOT NULL REFERENCES episodes (id) ON DELETE CASCADE,
    category   TEXT    NOT NULL,
    name       TEXT    NOT NULL,
    code       TEXT,                             -- ticker, only for category 股票
    detail     TEXT,
    quote      TEXT,
    start_sec  INTEGER NOT NULL
  );
  CREATE INDEX mentions_category ON mentions (category, episode_id);

  CREATE TABLE ask_usage (
    user_id TEXT    NOT NULL,
    date    TEXT    NOT NULL,                    -- YYYY-MM-DD, Asia/Taipei
    count   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, date)
  );

  CREATE TABLE ask_log (
    id              INTEGER PRIMARY KEY,
    user_id         TEXT NOT NULL,
    question        TEXT NOT NULL,
    tool_calls_json TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );
  CREATE INDEX ask_log_created ON ask_log (created_at);
  `,
  // Checkpoints so a retry only re-runs (and re-pays for) the step that failed
  `
  ALTER TABLE episodes ADD COLUMN summary_draft_json TEXT; -- summary waiting for embedding + publish
  ALTER TABLE episodes ADD COLUMN failed_step TEXT;        -- transcribe | summarize | embed
  `,
];

export function defaultDbPath(): string {
  return process.env.DB_PATH ?? path.resolve('data/app.db');
}

// The worker opens read-write and runs migrations. The web app opens readonly for pages
// and Q&A tools, plus one read-write connection (migrate: false) for quota and ask_log.
export function openDb(file = defaultDbPath(), opts: { readonly?: boolean; migrate?: boolean } = {}): DB {
  if (!opts.readonly && file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file, { readonly: opts.readonly ?? false, fileMustExist: opts.readonly ?? false });
  sqliteVec.load(db);
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  if (!opts.readonly) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    if (opts.migrate ?? true) migrate(db);
  }
  return db;
}

export function migrate(db: DB): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

export function toVecBlob(embedding: number[]): Buffer {
  const arr = new Float32Array(embedding);
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}
