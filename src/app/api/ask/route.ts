import OpenAI from 'openai';
import { z } from 'zod';
import { answer, type AskEvent, ASK_MODEL, ASK_TIMEOUT_MS, BROAD_TIMEOUT_MS, MAX_QUESTION_CHARS, newTrace, readCoverage } from '@/lib/ask/agent';
import { type AskOutcome, type Broaden, logAsk, logQuotaRejection, refundQuota, refundRetry, remaining, type RetryResult, taipeiDate, takeQuota, takeRetry } from '@/lib/ask/quota';
import { askCost } from '@/lib/cost';
import { AnswerRecorder } from '@/lib/ask/record';
import { currentUser } from '@/lib/auth';
import { readDb, writeDb } from '@/lib/server-db';

// A new question, or 擴大搜尋 of one already answered (its ask_log id, from the `logged` event)
const Body = z.union([
  z.object({ question: z.string().trim().min(1).max(MAX_QUESTION_CHARS) }).strict(),
  z.object({ retryOf: z.number().int().positive() }).strict(),
]);

const RETRY_REFUSED: Record<Exclude<RetryResult, { ok: true }>['reason'], [number, string]> = {
  missing: [404, '找不到這個問題，請重新問一次。'],
  unfinished: [409, '這個問題沒有回答完，請重新問一次。'],
  broad: [409, '這已經是擴大搜尋的結果了。'],
  used: [409, '這個問題已經擴大搜尋過了。'],
  site: [429, '今天全站的問答次數已滿，明天再來。'],
  unavailable: [503, '擴大搜尋暫時不能用，請稍後再試。'],
};

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
  const started = Date.now();
  const wdb = await writeDb();

  // 擴大搜尋 doesn't use up one of the listener's questions; the site's cap still counts it
  let question: string;
  let broaden: (Broaden & { of: number }) | null = null;
  let left: number;
  if ('retryOf' in parsed.data) {
    const of = parsed.data.retryOf;
    const r = takeRetry(wdb, user.id, of);
    if (!r.ok) {
      const [status, error] = RETRY_REFUSED[r.reason];
      return json(status, { error });
    }
    question = r.question;
    broaden = { ...r, of };
    left = remaining(wdb, user.id);
  } else {
    question = parsed.data.question;
    const quota = takeQuota(wdb, user.id);
    if (!quota.ok) {
      logQuotaRejection(wdb, user.id, question);
      return json(429, { error: quota.reason === 'user' ? '今天的問答次數用完了，明天 00:00 重置。' : '今天全站的問答次數已滿，明天再來。' });
    }
    left = quota.remaining;
  }
  const timeoutMs = broaden ? BROAD_TIMEOUT_MS : ASK_TIMEOUT_MS;

  const db = await readDb();
  const coverage = readCoverage(db, taipeiDate());
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(timeoutMs)]);
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
        emit({ type: 'quota', remaining: left });
        // A broadened question passed moderation when it was first asked (or it wouldn't have an answer)
        const mod = broaden ? null : await client.moderations.create({ model: 'omni-moderation-latest', input: question }, { signal });
        if (mod?.results.some((r) => r.flagged)) {
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
          ...(broaden ? { broaden: { queries: broaden.queries, citedEps: broaden.citedEps } } : {}),
          emit: (e) => {
            // A draft the agent took back (reset) isn't an answer the user keeps
            if (e.type === 'delta') answered = true;
            if (e.type === 'reset') answered = false;
            recorder.see(e);
            emit(e);
          },
        });
        outcome = recorder.cited() > 0 ? 'answered' : 'no_source';
        emit({ type: 'done' });
      } catch (err) {
        console.error('[ask]', err instanceof Error ? err.message : err);
        if (!answered) {
          if (broaden) refundRetry(wdb, broaden.of);
          else refundQuota(wdb, user.id);
        }
        const timedOut = signal.aborted && !req.signal.aborted;
        outcome = timedOut ? 'timeout' : req.signal.aborted ? 'aborted' : 'error';
        const what = timedOut ? `回答超過 ${timeoutMs / 1000} 秒，已中斷。` : '回答時發生錯誤。';
        emit({ type: 'error', message: answered ? what : `${what}這次不扣次數，請稍後再試。` });
      } finally {
        const id = logAsk(wdb, {
          userId: user.id,
          question,
          outcome,
          answer: recorder.labeled(), // as the page showed it, episode labels included
          cited: recorder.cited(),
          sources: recorder.citedSources(),
          ms: Date.now() - started,
          toolCalls: trace.toolCalls,
          inputTokens: trace.inputTokens,
          outputTokens: trace.outputTokens,
          costUsd: askCost(ASK_MODEL, trace),
          ...(broaden ? { retryOf: broaden.of } : {}),
        });
        if (id !== null) emit({ type: 'logged', id });
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
