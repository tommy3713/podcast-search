// One run of one question: the same answer() the site calls, followed the way the site
// logs it, then the rule checks and the judge.
import type OpenAI from 'openai';
import { answer, ASK_MODEL, ASK_TIMEOUT_MS, type Coverage, newTrace } from '../../src/lib/ask/agent.ts';
import { AnswerRecorder } from '../../src/lib/ask/record.ts';
import { askCost } from '../../src/lib/cost.ts';
import type { DB } from '../../src/lib/db.ts';
import type { GoldenQuestion } from './golden.ts';
import { judge } from './judge.ts';
import { type Checks, type PointVerdict, type RunResult, ruleChecks, runPassed, type SourceRef } from './score.ts';

const JUDGE_TIMEOUT_MS = 60_000;

const uniqueSorted = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b);

export type RunDeps = { db: DB; client: OpenAI; coverage: Coverage; timeoutMs?: number };

export async function runQuestion(q: GoldenQuestion, deps: RunDeps): Promise<RunResult> {
  const trace = newTrace();
  const recorder = new AnswerRecorder();
  const refs = new Map<number, SourceRef>();
  const started = Date.now();
  const signal = AbortSignal.timeout(deps.timeoutMs ?? ASK_TIMEOUT_MS);
  let error: string | undefined;
  try {
    await answer(q.question, {
      db: deps.db,
      client: deps.client,
      coverage: deps.coverage,
      trace,
      signal,
      emit: (e) => {
        recorder.see(e);
        if (e.type === 'sources') for (const s of e.sources) refs.set(s.n, { n: s.n, ep: s.ep });
      },
    });
  } catch (e) {
    error = signal.aborted ? 'timeout' : e instanceof Error ? e.message : String(e);
  }
  const ms = Date.now() - started;

  // Counted by the recorder, so `cited` is what the site would log
  const citedNs = recorder.citedNumbers();
  const facts = {
    answer: recorder.text,
    sources: [...refs.values()],
    retrievedEps: uniqueSorted([...refs.values()].map((s) => s.ep)),
    citedEps: uniqueSorted(citedNs.map((n) => refs.get(n)!.ep)),
    cited: citedNs.length,
  };

  let points: PointVerdict[] = [];
  let judgeCostUsd = 0;
  if (!error && q.points.length) {
    try {
      const j = await judge(deps.client, q, facts.answer, AbortSignal.timeout(JUDGE_TIMEOUT_MS));
      points = j.points;
      judgeCostUsd = j.costUsd;
    } catch (e) {
      error = `judge: ${e instanceof Error ? e.message : e}`;
    }
  }

  const checks: Checks = { ...ruleChecks(q, facts), points };
  return {
    ...facts,
    ...(error ? { error } : {}),
    pass: runPassed(checks, error),
    checks,
    toolCalls: trace.toolCalls,
    ms,
    costUsd: askCost(ASK_MODEL, trace),
    judgeCostUsd,
  };
}

// Runs tasks a few at a time, keeping the results in order
export async function pool<T, R>(items: T[], size: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await work(items[i]!, i);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}
