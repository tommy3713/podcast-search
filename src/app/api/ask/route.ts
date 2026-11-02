import OpenAI from 'openai';
import { z } from 'zod';
import { answer, type AskEvent, ASK_MODEL, type Coverage, MAX_QUESTION_CHARS, newTrace } from '@/lib/ask/agent';
import { type AskOutcome, logAsk, logQuotaRejection, refundQuota, taipeiDate, takeQuota } from '@/lib/ask/quota';
import { askCost } from '@/lib/cost';
import { AnswerRecorder } from '@/lib/ask/record';
import { currentUser } from '@/lib/auth';
import { readDb, writeDb } from '@/lib/server-db';

const TIMEOUT_MS = 30_000;
const Body = z.object({ question: z.string().trim().min(1).max(MAX_QUESTION_CHARS) });

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

export async function POST(req: Request) {
  // Same-origin JSON only: a cross-site form can't send this content type, and the
  // session cookie is SameSite=Lax anyway
  if (!req.headers.get('content-type')?.startsWith('application/json')) return json(415, { error: '格式錯誤' });
  const origin = req.headers.get('origin');
  if (origin && new URL(origin).host !== req.headers.get('host')) return json(403, { error: '來源不符' });

  const user = await currentUser();
  if (!user) return json(401, { error: '請先登入' });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(400, { error: `問題請在 ${MAX_QUESTION_CHARS} 字以內` });
  const question = parsed.data.question;
  const started = Date.now();

  const wdb = await writeDb();
  const quota = takeQuota(wdb, user.id);
  if (!quota.ok) {
    logQuotaRejection(wdb, user.id, question);
    return json(429, { error: quota.reason === 'user' ? '今天的問答次數用完了，明天 00:00 重置。' : '今天全站的問答次數已滿，明天再來。' });
  }

  const db = await readDb();
  const cov = db
    .prepare(`SELECT COUNT(*) AS count, MIN(episode_no) AS oldest, MAX(episode_no) AS newest FROM episodes WHERE status = 'done'`)
    .get() as Omit<Coverage, 'today'>;
  const coverage: Coverage = { ...cov, today: taipeiDate() };
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(TIMEOUT_MS)]);
  const client = new OpenAI();
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (e: AskEvent) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      };
      const trace = newTrace();
      const recorder = new AnswerRecorder();
      let outcome: AskOutcome = 'error';
      let answered = false;
      try {
        emit({ type: 'quota', remaining: quota.remaining });
        const mod = await client.moderations.create({ model: 'omni-moderation-latest', input: question }, { signal });
        if (mod.results.some((r) => r.flagged)) {
          answered = true; // counts against the quota
          outcome = 'moderated';
          emit({ type: 'error', message: '這個問題無法回答。' });
          return;
        }
        await answer(question, {
          db,
          client,
          coverage,
          signal,
          trace,
          emit: (e) => {
            if (e.type === 'delta') answered = true;
            recorder.see(e);
            emit(e);
          },
        });
        outcome = recorder.cited() > 0 ? 'answered' : 'no_source';
        emit({ type: 'done' });
      } catch (err) {
        console.error('[ask]', err instanceof Error ? err.message : err);
        if (!answered) refundQuota(wdb, user.id);
        const timedOut = signal.aborted && !req.signal.aborted;
        outcome = timedOut ? 'timeout' : req.signal.aborted ? 'aborted' : 'error';
        const what = timedOut ? '回答超過 30 秒，已中斷。' : '回答時發生錯誤。';
        emit({ type: 'error', message: answered ? what : `${what}這次不扣次數，請稍後再試。` });
      } finally {
        logAsk(wdb, {
          userId: user.id,
          question,
          outcome,
          answer: recorder.text,
          cited: recorder.cited(),
          ms: Date.now() - started,
          toolCalls: trace.toolCalls,
          inputTokens: trace.inputTokens,
          outputTokens: trace.outputTokens,
          costUsd: askCost(ASK_MODEL, trace),
        });
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
