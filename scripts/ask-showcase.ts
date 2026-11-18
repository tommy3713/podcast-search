// Asks SHOWCASE_QUESTIONS (src/lib/ask/showcase.ts) through answer() against DB_PATH and
// writes src/lib/ask/showcase.json, the answers /ask shows before anyone asks. Run it on a
// fresh snapshot (npm run db:pull), read every answer, and ask a question again with --only
// until it reads right; the answers go into a PR like any other text on the site. About
// US$0.01–0.02 a question.
//
// Usage: DB_PATH=data/prod.db tsx --env-file=.env.local scripts/ask-showcase.ts [--only 1,3]
// (--only takes 1-based positions in SHOWCASE_QUESTIONS; the others keep their answers)
import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import { answer, ASK_MODEL, ASK_TIMEOUT_MS, newTrace, readCoverage } from '../src/lib/ask/agent.ts';
import { taipeiDate } from '../src/lib/ask/quota.ts';
import { AnswerRecorder } from '../src/lib/ask/record.ts';
import { dropOffer, keptSources, SHOWCASE_QUESTIONS, ShowcaseSchema, type ShowcaseItem } from '../src/lib/ask/showcase.ts';
import { openDb } from '../src/lib/db.ts';

const FILE = path.join(import.meta.dirname, '../src/lib/ask/showcase.json');
const usage = `--only takes positions 1–${SHOWCASE_QUESTIONS.length}, comma-separated`;

const onlyArg = process.argv.indexOf('--only');
let only: Set<number> | null = null;
if (onlyArg > 0) {
  const raw = process.argv[onlyArg + 1];
  if (!raw) throw new Error(usage);
  only = new Set(raw.split(',').map(Number));
  if ([...only].some((i) => !Number.isInteger(i) || i < 1 || i > SHOWCASE_QUESTIONS.length)) throw new Error(usage);
}

const db = openDb(undefined, { readonly: true });
const today = taipeiDate();
// What the model is told is live, and what the page says was
const coverage = readCoverage(db, today);
const kept = fs.existsSync(FILE) ? ShowcaseSchema.parse(JSON.parse(fs.readFileSync(FILE, 'utf8'))) : [];
const client = new OpenAI();

const out = new Map<string, ShowcaseItem>(kept.map((k) => [k.q, k]));
// In SHOWCASE_QUESTIONS' order, leaving out answers to questions no longer listed; written
// after each answer, so one failure doesn't lose the ones already paid for
const save = () =>
  fs.writeFileSync(FILE, `${JSON.stringify(ShowcaseSchema.parse(SHOWCASE_QUESTIONS.flatMap((q) => out.get(q) ?? [])), null, 2)}\n`);

let failed = 0;
for (const [i, q] of SHOWCASE_QUESTIONS.entries()) {
  if (out.has(q) && only && !only.has(i + 1)) continue;
  // As the site asks: its timeout, and the events followed the way the route logs them
  const rec = new AnswerRecorder();
  try {
    await answer(q, { db, client, trace: newTrace(), coverage, signal: AbortSignal.timeout(ASK_TIMEOUT_MS), emit: (e) => rec.see(e) });
  } catch (err) {
    failed++;
    console.error(`\n## ${i + 1}. ${q}\n\nfailed: ${err instanceof Error ? err.message : err} (kept the previous answer, if any)`);
    continue;
  }
  const text = dropOffer(rec.text);
  const { sources, othersFound } = keptSources(text, rec.allSources());
  out.set(q, { q, askedAt: today, count: coverage.count, oldest: coverage.oldest, newest: coverage.newest, model: ASK_MODEL, text, sources, othersFound });
  save();
  console.log(`\n## ${i + 1}. ${q}\n\n${rec.labeled()}\n\n(${rec.allSources().length} sources found, ${sources.length} kept)`);
}
console.log(`\nwrote ${path.relative(process.cwd(), FILE)}${failed ? `; ${failed} failed` : ''}`);
if (failed) process.exitCode = 1;
