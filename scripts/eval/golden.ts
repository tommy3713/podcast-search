// The golden set (evals/golden.jsonl): one question per line with the checks its answer
// must pass. evals/README.md explains the fields and how to write questions.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { MAX_QUESTION_CHARS } from '../../src/lib/ask/agent.ts';

export const QUESTION_TYPES = ['detail', 'typo', 'list', 'time', 'crowded', 'safety', 'not_found'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

const idPrefix = (type: QuestionType) => (type === 'not_found' ? 'nf' : type);

export const GoldenQuestion = z
  .object({
    id: z.string().regex(/^[a-z]+-\d{2}$/),
    type: z.enum(QUESTION_TYPES),
    question: z.string().min(1).max(MAX_QUESTION_CHARS),
    expect_eps: z.array(z.number().int().positive()),
    min_eps: z.number().int().positive().optional(),
    queries: z.array(z.string().min(1)),
    points: z.array(z.string().min(1)),
    must_not: z.array(z.string().min(1)),
    refuse: z.boolean(),
    note: z.string().optional(),
  })
  .strict();
export type GoldenQuestion = z.infer<typeof GoldenQuestion>;

export function parseGolden(text: string): GoldenQuestion[] {
  const questions: GoldenQuestion[] = [];
  const seen = new Set<string>();
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    const fail = (why: string) => new Error(`golden line ${i + 1}: ${why}`);
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw fail('not valid JSON');
    }
    const p = GoldenQuestion.safeParse(raw);
    if (!p.success) throw fail(p.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; '));
    const q = p.data;
    if (seen.has(q.id)) throw fail(`id ${q.id} is used twice`);
    if (!q.id.startsWith(`${idPrefix(q.type)}-`)) throw fail(`id ${q.id} doesn't match type ${q.type}`);
    if (q.min_eps !== undefined && q.min_eps > q.expect_eps.length) throw fail(`${q.id}: min_eps is more than expect_eps has`);
    if (q.refuse && q.expect_eps.length) throw fail(`${q.id}: refuse means citing nothing, so expect_eps must be empty`);
    seen.add(q.id);
    questions.push(q);
  });
  return questions;
}

// How many of expect_eps must show up
export const needed = (q: GoldenQuestion) => q.min_eps ?? q.expect_eps.length;

// Bump when a run is scored by different rules, so results scored the old way aren't
// compared with new ones as if the answers had changed. 2: a citation pointing at another
// episode than its line names fails the run.
export const SCORING_VERSION = 2;

// Changes when anything a run is scored on changes, so a rewritten question isn't
// compared with its old results
export function questionHash(q: GoldenQuestion): string {
  const scored = [SCORING_VERSION, q.question, q.expect_eps, q.min_eps ?? null, q.points, q.must_not, q.refuse];
  return createHash('sha256').update(JSON.stringify(scored)).digest('hex').slice(0, 12);
}
