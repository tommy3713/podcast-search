// One run of one question: the same answer() the site calls, followed the way the site
// logs it, then the rule checks and the judge.
import type OpenAI from 'openai';
import { answer, ASK_MODEL, ASK_TIMEOUT_MS, BROAD_TIMEOUT_MS, type Coverage, newTrace } from '../../src/lib/ask/agent.ts';
import { searchedBefore } from '../../src/lib/ask/quota.ts';
import { AnswerRecorder } from '../../src/lib/ask/record.ts';
import { askCost } from '../../src/lib/cost.ts';
import type { DB } from '../../src/lib/db.ts';
import type { GoldenQuestion } from './golden.ts';
import { judge } from './judge.ts';
import { type Checks, type PointVerdict, type RunResult, ruleChecks, runPassed, type SourceRef } from './score.ts';
import { checkSupport, type CitedSource, SupportCheckError, type SupportVerdict } from './support.ts';

const JUDGE_TIMEOUT_MS = 60_000;

const uniqueSorted = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b);

// broad: answer once as the site does, then score the 擴大搜尋 answer made from that one
export type RunDeps = { db: DB; client: OpenAI; coverage: Coverage; timeoutMs?: number; broad?: boolean };

export async function runQuestion(q: GoldenQuestion, deps: RunDeps): Promise<RunResult> {
  const trace = newTrace();
  const recorder = new AnswerRecorder();
  const refs = new Map<number, SourceRef>();
  const texts = new Map<number, CitedSource>();
  const started = Date.now();
  let error: string | undefined;
  // --broad: the first answer, as the site would have logged it, only to say what it searched
  // and cited; its tokens count toward the run's cost
  let broaden: { queries: string[]; citedEps: number[] } | undefined;
  if (deps.broad) {
    const first = newTrace();
    const seen = new AnswerRecorder();
    try {
      await answer(q.question, { db: deps.db, client: deps.client, coverage: deps.coverage, trace: first, signal: AbortSignal.timeout(ASK_TIMEOUT_MS), emit: (e) => seen.see(e) });
    } catch {
      // the site offers 擴大搜尋 only on a finished answer, but the eval still asks it, from what was searched
    }
    broaden = searchedBefore(JSON.stringify(first.toolCalls), JSON.stringify(seen.citedSources()));
    for (const k of ['inputTokens', 'cachedTokens', 'outputTokens', 'embeddingTokens'] as const) trace[k] += first[k];
  }
  const signal = AbortSignal.timeout(deps.timeoutMs ?? (broaden ? BROAD_TIMEOUT_MS : ASK_TIMEOUT_MS));
  try {
    await answer(q.question, {
      db: deps.db,
      client: deps.client,
      coverage: deps.coverage,
      trace,
      signal,
      ...(broaden ? { broaden } : {}),
      emit: (e) => {
        recorder.see(e);
        if (e.type === 'sources') {
          for (const s of e.sources) {
            refs.set(s.n, { n: s.n, ep: s.ep });
            // As the page's source card shows it
            texts.set(s.n, { n: s.n, ep: s.ep, t: s.t, text: s.label ? `${s.label}：${s.text}` : s.text });
          }
        }
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
    shown: recorder.labeled(),
    sources: [...refs.values()],
    retrievedEps: uniqueSorted([...refs.values()].map((s) => s.ep)),
    citedEps: uniqueSorted(citedNs.map((n) => refs.get(n)!.ep)),
    cited: citedNs.length,
  };

  // The passages the answer cites, kept so a result can be read without the database
  const citedSources = citedNs.map((n) => texts.get(n)!);
  let points: PointVerdict[] = [];
  let judgeCostUsd = 0;
  let support: SupportVerdict[] | undefined;
  let supportCostUsd = 0;
  let supportError: string | undefined;
  if (!error && q.points.length) {
    try {
      const j = await judge(deps.client, q, facts.shown, AbortSignal.timeout(JUDGE_TIMEOUT_MS));
      points = j.points;
      judgeCostUsd = j.costUsd;
    } catch (e) {
      error = `judge: ${e instanceof Error ? e.message : e}`;
    }
  }
  // After the judge rather than beside it, so a run has one request open at a time, as
  // before. Only reported, so a failed check doesn't fail the run.
  if (!error) {
    try {
      const s = await checkSupport(deps.client, q.question, facts.answer, citedSources, AbortSignal.timeout(JUDGE_TIMEOUT_MS));
      support = s.verdicts;
      supportCostUsd = s.costUsd;
    } catch (e) {
      supportError = e instanceof Error ? e.message : String(e);
      if (e instanceof SupportCheckError) supportCostUsd = e.costUsd;
    }
  }

  const checks: Checks = { ...ruleChecks(q, facts), points, ...(support ? { support } : {}) };
  return {
    ...facts,
    citedSources,
    ...(error ? { error } : {}),
    ...(supportError ? { supportError } : {}),
    pass: runPassed(checks, error),
    checks,
    toolCalls: trace.toolCalls,
    ms,
    costUsd: askCost(ASK_MODEL, trace),
    judgeCostUsd,
    supportCostUsd,
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
