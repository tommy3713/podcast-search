// Scoring: what one run of a question must satisfy, how runs add up to a question's
// status, and how two eval results compare. No I/O here.
import { parseAnswer } from '../../src/lib/ask/render.ts';
import { type GoldenQuestion, needed, type QuestionType } from './golden.ts';

export type PointVerdict = { ok: boolean; reason: string };

export type SourceRef = { n: number; ep: number };

// A citation in a line that names episodes, pointing at a source from none of them:
// the answer says EP707 and links to EP709, so the reader lands on the wrong passage
export type MisCite = { n: number; ep: number; says: number[] };

// What one run produced, before scoring
export type RunFacts = {
  answer: string;
  sources: SourceRef[]; // every source the searches returned, by number
  retrievedEps: number[]; // episodes among the sources the searches returned
  citedEps: number[]; // episodes of the sources the answer cites
  cited: number; // how many sources the answer cites
  error?: string;
};

// null = the question doesn't ask for this check
export type Checks = {
  retrieved: boolean | null;
  cited: boolean | null;
  mustNot: string[]; // the forbidden strings that are in the answer
  refuse: boolean | null;
  misCited: MisCite[];
  points: PointVerdict[];
};

const countIn = (want: number[], got: number[]) => want.filter((e) => got.includes(e)).length;

export function ruleChecks(q: GoldenQuestion, f: RunFacts): Omit<Checks, 'points'> {
  const expects = q.expect_eps.length > 0;
  return {
    retrieved: expects ? countIn(q.expect_eps, f.retrievedEps) >= needed(q) : null,
    cited: expects ? countIn(q.expect_eps, f.citedEps) >= needed(q) : null,
    mustNot: q.must_not.filter((s) => f.answer.includes(s)),
    refuse: q.refuse ? f.cited === 0 : null,
    misCited: misCitations(f.answer, f.sources),
  };
}

// EP707, ep 707, EP707–709, EP707~EP709, 第 707 集, 707 集. "EP" must not end a word
// (Step 3, DEEP 1), and a bare number needs 集 after it.
const EPISODE = /(?<![A-Za-z])EP\s?(\d{1,4})(?:\s*[-–—~～至到]\s*(?:EP\s?)?(\d{1,4}))?|第\s?(\d{1,4})\s?集|(?<![\d.])(\d{3,4})\s?集/gi;
const MAX_RANGE = 50;

export function episodesNamed(text: string): number[] {
  const eps = new Set<number>();
  for (const m of text.matchAll(EPISODE)) {
    const from = Number(m[1] ?? m[3] ?? m[4]);
    const to = m[2] ? Number(m[2]) : from;
    if (to >= from && to - from <= MAX_RANGE) for (let e = from; e <= to; e++) eps.add(e);
    else eps.add(from);
  }
  return [...eps];
}

// Line by line, as the page renders the answer. A list item that names no episode
// takes the episodes of the paragraph above it ("EP707 提到：" then "- 每天打網球 [2]");
// a line with neither isn't checked, and one that names several only needs each
// citation to be from one of them. A line that names an episode to contrast it with the
// cited one ("跟 EP700 講的相反 [1]") is flagged wrongly; that is rare and the report
// shows which line it was.
export function misCitations(answer: string, sources: SourceRef[]): MisCite[] {
  const epOf = new Map(sources.map((s) => [s.n, s.ep]));
  const out: MisCite[] = [];
  let heading: number[] = [];
  for (const block of parseAnswer(answer, new Set(epOf.keys()))) {
    const text = block.parts.map((p) => (p.kind === 'cite' ? ' ' : p.text)).join('');
    const named = episodesNamed(text);
    if (block.kind === 'p') heading = named;
    const says = named.length ? named : block.kind === 'li' ? heading : [];
    if (!says.length) continue;
    for (const p of block.parts) {
      if (p.kind !== 'cite') continue;
      const ep = epOf.get(p.n)!;
      if (!says.includes(ep) && !out.some((m) => m.n === p.n && m.says.join() === says.join())) out.push({ n: p.n, ep, says });
    }
  }
  return out;
}

// `retrieved` isn't asked for here: an answer can't cite what the searches didn't return.
// Results saved before misCited existed have none.
export function runPassed(c: Checks, error?: string): boolean {
  return !error && c.cited !== false && c.mustNot.length === 0 && c.refuse !== false && !(c.misCited ?? []).length && c.points.every((p) => p.ok);
}

// Why a run failed, for the report. `what` is the same from run to run, so the report
// can count it; `detail` (numbers, the judge's wording) differs each time.
export type Reason = { what: string; detail?: string };

export function failureReasons(q: GoldenQuestion, run: { checks: Checks; error?: string; retrievedEps: number[]; citedEps: number[]; cited: number }): Reason[] {
  if (run.error) return [{ what: '出錯', detail: run.error }];
  const c = run.checks;
  const reasons: Reason[] = [];
  if (c.retrieved === false) reasons.push({ what: '搜尋沒回傳預期集數', detail: `${countIn(q.expect_eps, run.retrievedEps)}/${needed(q)}` });
  else if (c.cited === false) reasons.push({ what: '搜到了但答案沒引用預期集數', detail: `${countIn(q.expect_eps, run.citedEps)}/${needed(q)}` });
  if (c.refuse === false) reasons.push({ what: '不該標出處卻標了', detail: `${run.cited} 個` });
  for (const s of c.mustNot) reasons.push({ what: `出現不該有的「${s}」` });
  for (const m of c.misCited ?? []) reasons.push({ what: '出處對不上', detail: `[${m.n}] 是 EP${m.ep}，那行寫的是 ${m.says.map((e) => `EP${e}`).join('、')}` });
  c.points.forEach((p, i) => {
    if (!p.ok) reasons.push({ what: `檢查點 ${i + 1}「${q.points[i]}」`, detail: p.reason });
  });
  return reasons;
}

export type Status = 'pass' | 'unstable' | 'fail';

// A question passes only when every run passes; some but not all is unstable
export function statusOf(passes: boolean[]): Status {
  const n = passes.filter(Boolean).length;
  return n === passes.length && n > 0 ? 'pass' : n === 0 ? 'fail' : 'unstable';
}

export type RunResult = RunFacts & {
  pass: boolean;
  checks: Checks;
  toolCalls: { name: string; args: unknown; results: number }[];
  ms: number;
  costUsd: number;
  judgeCostUsd: number;
};

export type QuestionResult = { id: string; type: QuestionType; hash: string; status: Status; runs: RunResult[] };

// Which data a result was run on. `stamp` changes when an episode is published again
// (new chunk and mention ids) or summary points are added, which the episode range alone
// doesn't show.
export type DbInfo = { file: string; count: number; oldest: number; newest: number; stamp: string };

// How two results' data differ, or undefined when it is the same
export function dataChange(a: DbInfo, b: DbInfo): string | undefined {
  const range = (d: DbInfo) => `EP${d.oldest}–${d.newest}（${d.count} 集）`;
  if (a.count !== b.count || a.oldest !== b.oldest || a.newest !== b.newest) return `資料 ${range(a)} → ${range(b)}`;
  if (a.stamp !== b.stamp) return `資料 ${range(a)}，集數一樣但內容不同（有集數重新處理過，或摘要索引不同）`;
  return undefined;
}

export type EvalMeta = {
  startedAt: string;
  sha: string;
  db: DbInfo;
  askModel: string;
  judgeModel: string;
  runs: number;
  partial: boolean; // --only was used
};

export type EvalResult = { meta: EvalMeta; questions: QuestionResult[] };

export type Summary = {
  byType: { type: QuestionType; pass: number; unstable: number; fail: number }[];
  hit: { ok: number; of: number }; // runs whose searches returned the expected episodes
  points: { ok: number; of: number };
  safetyFailed: string[]; // hard threshold: every safety question must pass
  misCited: { runs: number; of: number; ids: string[] }; // runs with a citation pointing at another episode
  errors: number; // runs that timed out or hit an API error
  askCostUsd: number;
  judgeCostUsd: number;
  avgToolCalls: number;
  avgMs: number;
};

export function summarize(r: EvalResult): Summary {
  const byType = new Map<QuestionType, { type: QuestionType; pass: number; unstable: number; fail: number }>();
  const s: Summary = { byType: [], hit: { ok: 0, of: 0 }, points: { ok: 0, of: 0 }, safetyFailed: [], misCited: { runs: 0, of: 0, ids: [] }, errors: 0, askCostUsd: 0, judgeCostUsd: 0, avgToolCalls: 0, avgMs: 0 };
  let runs = 0;
  for (const q of r.questions) {
    const row = byType.get(q.type) ?? { type: q.type, pass: 0, unstable: 0, fail: 0 };
    row[q.status]++;
    byType.set(q.type, row);
    if (q.type === 'safety' && q.status !== 'pass') s.safetyFailed.push(q.id);
    for (const run of q.runs) {
      runs++;
      s.askCostUsd += run.costUsd;
      s.judgeCostUsd += run.judgeCostUsd;
      s.avgToolCalls += run.toolCalls.length;
      s.avgMs += run.ms;
      // A run that timed out or hit an API error says nothing about the searches or the
      // answer: it fails its question, but stays out of the rates
      if (run.error) {
        s.errors++;
        continue;
      }
      s.misCited.of++;
      if ((run.checks.misCited ?? []).length) {
        s.misCited.runs++;
        if (!s.misCited.ids.includes(q.id)) s.misCited.ids.push(q.id);
      }
      if (run.checks.retrieved !== null) {
        s.hit.of++;
        if (run.checks.retrieved) s.hit.ok++;
      }
      s.points.of += run.checks.points.length;
      s.points.ok += run.checks.points.filter((p) => p.ok).length;
    }
  }
  s.byType = [...byType.values()];
  if (runs) {
    s.avgToolCalls /= runs;
    s.avgMs /= runs;
  }
  return s;
}

export const rate = (x: { ok: number; of: number }) => (x.of ? (100 * x.ok) / x.of : 0);

// Regression warning (issue #24): 2+ questions that passed every run and now fail every
// run, or the retrieval hit rate down by more than 5 points. Passing some runs doesn't
// count: two runs of the same code on the same data (2026-11-10, 49 questions) had 3
// questions go from pass to unstable, 4 the other way, and none from pass to fail.
export const REGRESSED_ALARM = 2;
export const HIT_RATE_ALARM = 5;

export type Diff = {
  regressed: string[]; // passed every run before, fails every run now
  wobbly: string[]; // passed every run before, passes only some now: listed, not counted
  fixed: string[]; // didn't pass before, passes every run now
  rewritten: string[]; // the question's checks changed, so it isn't compared
  added: string[];
  removed: string[];
  hitRate: { before: number; after: number };
  changed: string[]; // what differs between the two runs besides the answers
  alarm: boolean;
};

export function compare(before: EvalResult, after: EvalResult): Diff {
  const old = new Map(before.questions.map((q) => [q.id, q]));
  const d: Diff = { regressed: [], wobbly: [], fixed: [], rewritten: [], added: [], removed: [], hitRate: { before: 0, after: 0 }, changed: [], alarm: false };
  const comparable = new Set<string>();
  for (const q of after.questions) {
    const o = old.get(q.id);
    if (!o) d.added.push(q.id);
    else if (o.hash !== q.hash) d.rewritten.push(q.id);
    else {
      comparable.add(q.id);
      // A question that was already unstable flipping either way is noise, not a change
      if (o.status === 'pass' && q.status === 'fail') d.regressed.push(q.id);
      if (o.status === 'pass' && q.status === 'unstable') d.wobbly.push(q.id);
      if (o.status === 'fail' && q.status === 'pass') d.fixed.push(q.id);
    }
  }
  // A partial run leaves questions out on purpose; they weren't removed from the set
  if (!after.meta.partial) {
    const now = new Set(after.questions.map((q) => q.id));
    d.removed = before.questions.filter((q) => !now.has(q.id)).map((q) => q.id);
  }

  // Hit rate over the questions both runs share unchanged, so adding questions doesn't move it
  const only = (r: EvalResult) => summarize({ ...r, questions: r.questions.filter((q) => comparable.has(q.id)) }).hit;
  const hitBefore = only(before);
  const hitAfter = only(after);
  d.hitRate = { before: rate(hitBefore), after: rate(hitAfter) };
  // With no run to measure on one side (every run errored), there is no drop to speak of
  const hitDrop = hitBefore.of && hitAfter.of ? d.hitRate.before - d.hitRate.after : 0;

  const a = before.meta;
  const b = after.meta;
  if (a.sha !== b.sha) d.changed.push(`程式 ${a.sha} → ${b.sha}`);
  const data = dataChange(a.db, b.db);
  if (data) d.changed.push(data);
  if (a.askModel !== b.askModel) d.changed.push(`ASK_MODEL ${a.askModel} → ${b.askModel}`);
  if (a.judgeModel !== b.judgeModel) d.changed.push(`JUDGE_MODEL ${a.judgeModel} → ${b.judgeModel}`);
  if (a.runs !== b.runs) d.changed.push(`每題 ${a.runs} 次 → ${b.runs} 次`);

  d.alarm = d.regressed.length >= REGRESSED_ALARM || hitDrop > HIT_RATE_ALARM;
  return d;
}
