import { connection } from 'next/server';
import { type DB, defaultDbPath, openDb } from './db.ts';

// Pages and Q&A tools only read. The worker is the main writer; WAL lets both run at once.
let readonly: DB | undefined;
// Only for ask_usage and ask_log. Never handed to anything the model can call.
let writable: DB | undefined;

export async function readDb(): Promise<DB> {
  // better-sqlite3 is synchronous, so without this the queries would run at build time
  await connection();
  return (readonly ??= openDb(defaultDbPath(), { readonly: true }));
}

export async function writeDb(): Promise<DB> {
  await connection();
  return (writable ??= openDb(defaultDbPath(), { migrate: false }));
}
