// Checks /ask against the golden set (evals/golden.jsonl, issue #24).
//
//   npm run eval                          every question, 3 runs each, with the judge
//   npm run eval -- --retrieval-only      search functions only: no model, no API key
//   npm run eval -- --only safety,nf-01   some types or ids (never becomes the baseline)
//   npm run eval -- --runs 1 --baseline evals/results/<file>.json
//
// Reads DB_PATH (default data/prod.db, the snapshot from `npm run db:pull`) read-only,
// calls answer() directly like scripts/ask-cli.ts (no quota, nothing logged), saves the
// result under evals/results/ (gitignored) and compares it with the last full one.
// Exits 1 when a safety question fails or the regression warning fires.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import OpenAI from 'openai';
import { ASK_MODEL } from '../src/lib/ask/agent.ts';
import { taipeiDate } from '../src/lib/ask/quota.ts';
import { openDb } from '../src/lib/db.ts';
import { type GoldenQuestion, parseGolden, questionHash, QUESTION_TYPES } from './eval/golden.ts';
import { JUDGE_MODEL } from './eval/judge.ts';
import { reportDiff, reportEval, reportRetrieval } from './eval/report.ts';
import { retrievalCheck, type RetrievalRun } from './eval/retrieval.ts';
import { pool, runQuestion } from './eval/run.ts';
import { compare, type EvalResult, type QuestionResult, statusOf, summarize } from './eval/score.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const RESULTS = path.join(ROOT, 'evals/results');

const { values: opt } = parseArgs({
  options: {
    'retrieval-only': { type: 'boolean', default: false },
    runs: { type: 'string', default: '3' },
    only: { type: 'string' },
    baseline: { type: 'string' },
    concurrency: { type: 'string', default: '4' },
  },
});
const runs = Number(opt.runs);
const concurrency = Number(opt.concurrency);
if (!Number.isInteger(runs) || runs < 1 || !Number.isInteger(concurrency) || concurrency < 1) throw new Error('--runs and --concurrency take a whole number, 1 or more');

const golden = parseGolden(fs.readFileSync(path.join(ROOT, 'evals/golden.jsonl'), 'utf8'));
const picked = pick(golden, opt.only);
const partial = picked.length < golden.length;

const dbPath = process.env.DB_PATH ?? path.join(ROOT, 'data/prod.db');
const db = openDb(dbPath, { readonly: true });
const cov = db.prepare(`SELECT COUNT(*) AS count, MIN(episode_no) AS oldest, MAX(episode_no) AS newest FROM episodes WHERE status = 'done'`).get() as {
  count: number;
  oldest: number;
  newest: number;
};
if (!cov.count) throw new Error(`${dbPath} has no live episodes`);

// Taipei time, like the rest of the project's dates: 2026-11-10T15:49
const startedAt = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).slice(0, 16).replace(' ', 'T');
const sha = gitSha();
const kind = opt['retrieval-only'] ? 'retrieval' : 'full';
const before = loadBaseline(kind, opt.baseline);

let failed = false;
if (opt['retrieval-only']) {
  const result: RetrievalRun = { meta: { startedAt, sha, db: cov, partial }, questions: picked.map((q) => retrievalCheck(db, q)) };
  const file = save(result, kind, partial);
  console.log(reportRetrieval(result, golden, before && { run: before.data as RetrievalRun, name: before.name }));
  console.log(`\n存到 ${path.relative(ROOT, file)}`);
} else {
  const client = new OpenAI();
  const coverage = { ...cov, today: taipeiDate() };
  console.log(`${picked.length} 題 × ${runs} 次，資料 ${path.relative(ROOT, dbPath)}，一次跑 ${concurrency} 題…`);
  let done = 0;
  const questions = await pool(picked, concurrency, async (q): Promise<QuestionResult> => {
    const results = [];
    for (let i = 0; i < runs; i++) results.push(await runQuestion(q, { db, client, coverage }));
    const status = statusOf(results.map((r) => r.pass));
    console.log(`  ${String(++done).padStart(3)}/${picked.length}  ${q.id.padEnd(11)} ${status}`);
    return { id: q.id, type: q.type, hash: questionHash(q), status, runs: results };
  });
  const result: EvalResult = { meta: { startedAt, sha, db: cov, askModel: ASK_MODEL, judgeModel: JUDGE_MODEL, runs, partial }, questions };
  const file = save(result, kind, partial);
  console.log(`\n${reportEval(result, golden)}`);
  if (before) {
    const diff = compare(before.data as EvalResult, result);
    console.log(reportDiff(diff, before.name));
    failed ||= diff.alarm;
  } else {
    console.log(partial ? '\n沒有上一次的完整結果可以比。' : '\n沒有上一次的結果可以比，這次就是基準。');
  }
  failed ||= summarize(result).safetyFailed.length > 0;
  console.log(`\n存到 ${path.relative(ROOT, file)}`);
}
process.exit(failed ? 1 : 0);

// --only takes ids and types, separated by commas
function pick(all: GoldenQuestion[], only: string | undefined): GoldenQuestion[] {
  if (!only) return all;
  const wanted = only.split(',').map((s) => s.trim()).filter(Boolean);
  const types: readonly string[] = QUESTION_TYPES;
  const unknown = wanted.filter((w) => !types.includes(w) && !all.some((q) => q.id === w));
  if (unknown.length) throw new Error(`--only: no such id or type: ${unknown.join(', ')}`);
  return all.filter((q) => wanted.includes(q.id) || wanted.includes(q.type));
}

function gitSha(): string {
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
    return git('rev-parse', '--short', 'HEAD') + (git('status', '--porcelain') ? '-dirty' : '');
  } catch {
    return 'unknown';
  }
}

// File names start with the time, so the last one by name is the newest. Partial runs
// are kept but never picked as the baseline.
function fileName(kind: string, isPartial: boolean): string {
  return `${startedAt.replace(':', '')}-${sha}${kind === 'retrieval' ? '-retrieval' : ''}${isPartial ? '-partial' : ''}.json`;
}

function save(result: unknown, kind: string, isPartial: boolean): string {
  fs.mkdirSync(RESULTS, { recursive: true });
  const file = path.join(RESULTS, fileName(kind, isPartial));
  fs.writeFileSync(file, `${JSON.stringify(result, null, 1)}\n`);
  return file;
}

function loadBaseline(kind: string, given: string | undefined): { name: string; data: unknown } | undefined {
  let file = given && path.resolve(given);
  if (!file) {
    if (!fs.existsSync(RESULTS)) return undefined;
    const names = fs
      .readdirSync(RESULTS)
      .filter((n) => n.endsWith('.json') && !n.endsWith('-partial.json') && n.endsWith('-retrieval.json') === (kind === 'retrieval'))
      .sort();
    const last = names.at(-1);
    if (!last) return undefined;
    file = path.join(RESULTS, last);
  }
  return { name: path.basename(file), data: JSON.parse(fs.readFileSync(file, 'utf8')) };
}
