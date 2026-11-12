// Checks /ask against the golden set (evals/golden.jsonl, issue #24).
//
//   npm run eval                          every question, 3 runs each, with the judge
//   npm run eval -- --retrieval-only      search functions only: no model, no API key
//   npm run eval -- --only safety,nf-01   some types or ids (never becomes the baseline)
//   npm run eval -- --set-baseline        make this result the one later runs compare with
//   npm run eval -- --runs 1 --baseline evals/results/<file>.json
//
// Reads DB_PATH (default data/prod.db, the snapshot from `npm run db:pull`) read-only,
// calls answer() directly like scripts/ask-cli.ts (no quota, nothing logged) and saves
// the result under evals/results/ (gitignored). It compares with the baseline, which only
// changes on --set-baseline (the first full run becomes it by itself), so a result that
// regressed doesn't hide the regression from the next run.
// Exits 1 when a safety question fails or the regression warning fires.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import OpenAI from 'openai';
import { ASK_MODEL, readCoverage } from '../src/lib/ask/agent.ts';
import { taipeiDate } from '../src/lib/ask/quota.ts';
import { type DB, openDb } from '../src/lib/db.ts';
import { staleSummaryPoints } from '../worker/summary-index.ts';
import { type GoldenQuestion, parseGolden, questionHash, QUESTION_TYPES } from './eval/golden.ts';
import { JUDGE_MODEL } from './eval/judge.ts';
import { reportDiff, reportEval, reportRetrieval } from './eval/report.ts';
import { retrievalCheck, type RetrievalRun } from './eval/retrieval.ts';
import { pool, runQuestion } from './eval/run.ts';
import { compare, type DbInfo, type EvalResult, type QuestionResult, statusOf, summarize } from './eval/score.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const RESULTS = path.join(ROOT, 'evals/results');

const { values: opt } = parseArgs({
  options: {
    'retrieval-only': { type: 'boolean', default: false },
    'set-baseline': { type: 'boolean', default: false },
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
if (partial && opt['set-baseline']) throw new Error('--set-baseline needs every question: leave out --only');

const kind = opt['retrieval-only'] ? 'retrieval' : 'full';
const baselineFile = path.join(RESULTS, kind === 'retrieval' ? 'baseline-retrieval.json' : 'baseline.json');
// Read before anything is paid for, so a wrong file stops the run here
const before = loadBaseline(opt.baseline ? path.resolve(opt.baseline) : baselineFile, opt.baseline !== undefined);

const dbPath = process.env.DB_PATH ?? path.join(ROOT, 'data/prod.db');
const db = openDb(dbPath, { readonly: true });
const coverage = readCoverage(db, taipeiDate());
if (!coverage.count) throw new Error(`${dbPath} has no live episodes`);
const dbInfo: DbInfo = { file: path.basename(dbPath), count: coverage.count, oldest: coverage.oldest, newest: coverage.newest, stamp: dbStamp(db) };
// Vector search also ranks chunks through the summary points, which a snapshot taken before
// they existed lacks (the live worker adds them at startup). Keyword-only retrieval doesn't use them.
if (kind === 'full') {
  const fill = `DB_PATH=${path.relative(ROOT, dbPath)} npm run worker -- index-summaries`;
  if (!db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'summary_points'`).get()) {
    throw new Error(`${dbPath} has no summary_points table; run ${fill}`);
  }
  const { stale, broken } = staleSummaryPoints(db);
  if (stale.length || broken.length) console.warn(`⚠️ ${stale.length + broken.length} 集的摘要索引不是最新的，搜尋會跟網站不一樣：${fill}`);
}

// Taipei time, like the rest of the project's dates: 2026-11-10T15:49
const startedAt = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).slice(0, 16).replace(' ', 'T');
const sha = gitSha();

let failed = false;
let clean = true; // no run hit an error, so the result is fit to be a baseline
let result: EvalResult | RetrievalRun;
if (kind === 'retrieval') {
  result = { meta: { startedAt, sha, db: dbInfo, partial }, questions: picked.map((q) => retrievalCheck(db, q)) };
  console.log(reportRetrieval(result, golden, before && { run: before.data as RetrievalRun, name: before.name }));
} else {
  const client = new OpenAI();
  console.log(`${picked.length} 題 × ${runs} 次，資料 ${path.relative(ROOT, dbPath)}，一次跑 ${concurrency} 題…`);
  let done = 0;
  const questions = await pool(picked, concurrency, async (q): Promise<QuestionResult> => {
    const results = [];
    for (let i = 0; i < runs; i++) results.push(await runQuestion(q, { db, client, coverage }));
    const status = statusOf(results.map((r) => r.pass));
    console.log(`  ${String(++done).padStart(3)}/${picked.length}  ${q.id.padEnd(11)} ${status}`);
    return { id: q.id, type: q.type, hash: questionHash(q), status, runs: results };
  });
  result = { meta: { startedAt, sha, db: dbInfo, askModel: ASK_MODEL, judgeModel: JUDGE_MODEL, runs, partial }, questions };
  const summary = summarize(result);
  clean = summary.errors === 0;
  console.log(`\n${reportEval(result, golden)}`);
  if (before) {
    const diff = compare(before.data as EvalResult, result);
    console.log(reportDiff(diff, before.name));
    failed ||= diff.alarm;
  }
  failed ||= summary.safetyFailed.length > 0;
}
db.close();

const file = path.join(RESULTS, `${startedAt.replace(':', '')}-${sha}${kind === 'retrieval' ? '-retrieval' : ''}${partial ? '-partial' : ''}.json`);
const json = `${JSON.stringify(result, null, 1)}\n`;
fs.mkdirSync(RESULTS, { recursive: true });
fs.writeFileSync(file, json);
console.log(`\n存到 ${path.relative(ROOT, file)}`);

// The first full result is the baseline; after that only --set-baseline replaces it
const first = !partial && !fs.existsSync(baselineFile);
if (opt['set-baseline'] || (first && clean)) {
  fs.writeFileSync(baselineFile, json);
  console.log(`這次的結果存成基準（${path.relative(ROOT, baselineFile)}）${clean ? '' : '。⚠ 有執行出錯，這份基準不可靠'}`);
} else if (first) {
  console.log('有執行出錯，沒有存成基準。重跑一次，或確定要用就加 --set-baseline。');
} else if (!before) {
  console.log('還沒有基準可以比：先不加 --only 跑一次。');
} else if (!partial && !opt.baseline) {
  console.log('基準沒有變。要把這次的結果當成新基準，加 --set-baseline 重跑。');
}
// Not process.exit(): it can cut off output that is still on its way down a pipe
process.exitCode = failed ? 1 : 0;

// --only takes ids and types, separated by commas
function pick(all: GoldenQuestion[], only: string | undefined): GoldenQuestion[] {
  if (!only) return all;
  const wanted = only.split(',').map((s) => s.trim()).filter(Boolean);
  const types: readonly string[] = QUESTION_TYPES;
  const unknown = wanted.filter((w) => !types.includes(w) && !all.some((q) => q.id === w));
  if (unknown.length) throw new Error(`--only: no such id or type: ${unknown.join(', ')}`);
  return all.filter((q) => wanted.includes(q.id) || wanted.includes(q.type));
}

// The commit, plus a hash of the uncommitted changes: two runs between commits, with
// different edits, must not look like the same code
function gitSha(): string {
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const head = git('rev-parse', '--short', 'HEAD').trim();
    const status = git('status', '--porcelain');
    if (!status) return head;
    const untracked = git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean);
    const h = createHash('sha256').update(status).update(git('diff', 'HEAD'));
    for (const f of untracked) h.update(f).update(fs.readFileSync(path.join(ROOT, f)));
    return `${head}-dirty-${h.digest('hex').slice(0, 6)}`;
  } catch {
    return 'unknown';
  }
}

// Publishing an episode again gives its chunks and mentions new ids, so these four
// numbers change whenever the searchable content does
function dbStamp(d: DB): string {
  const one = (table: string) => d.prepare(`SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS top FROM ${table}`).get() as { n: number; top: number };
  const c = one('chunks');
  const m = one('mentions');
  // Summary points change what vector search finds. Left out while there are none, so a
  // snapshot from before them keeps the stamp its baselines were saved with.
  const hasPoints = d.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'summary_points'`).get();
  const p = hasPoints ? one('summary_points') : { n: 0, top: 0 };
  return `${c.n}.${c.top}.${m.n}.${m.top}${p.n ? `.${p.n}.${p.top}` : ''}`;
}

// A file given with --baseline must exist and fit; the default one may be absent
function loadBaseline(file: string, given: boolean): { name: string; data: unknown } | undefined {
  if (!fs.existsSync(file)) {
    if (given) throw new Error(`--baseline: ${file} doesn't exist`);
    return undefined;
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { meta?: { partial?: boolean; runs?: number }; questions?: unknown };
  const name = path.relative(ROOT, file);
  if (!data.meta || !Array.isArray(data.questions)) throw new Error(`${name} isn't an eval result`);
  const isFull = typeof data.meta.runs === 'number';
  if (isFull !== (kind === 'full')) throw new Error(`${name} is a ${isFull ? 'full' : '--retrieval-only'} result; this run needs the other kind`);
  if (data.meta.partial) throw new Error(`${name} is a partial result (--only) and can't be a baseline`);
  return { name: path.basename(file), data };
}
