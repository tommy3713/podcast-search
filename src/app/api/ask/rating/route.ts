import { z } from 'zod';
import { currentUser } from '@/lib/auth';
import { anonToken, anonVisitor, clientAddress, cookieValue } from '@/lib/ask/anon';
import { ASK_LOG_DAYS, rateAsk, type RateResult, taipeiDate } from '@/lib/ask/quota';
import { MAX_RATING_NOTE_CHARS, RATING_REASONS, RATINGS } from '@/lib/ask/rating';
import { writeDb } from '@/lib/server-db';

// The answer's ask_log id comes from the `logged` event of /api/ask
const Body = z
  .object({
    id: z.number().int().positive(),
    rating: z.enum(RATINGS),
    reasons: z.array(z.enum(RATING_REASONS)).max(RATING_REASONS.length).optional(),
    note: z
      .string()
      .trim()
      .refine((s) => [...s].length <= MAX_RATING_NOTE_CHARS)
      .nullable()
      .optional(),
  })
  .strict();

const REFUSED: Record<Exclude<RateResult, { ok: true }>['reason'], [number, string]> = {
  missing: [404, `找不到這個回答（問答保留 ${ASK_LOG_DAYS} 天；沒登入時只能評同一個瀏覽器當天的回答）。`],
  unfinished: [409, '這個問題沒有回答完，不能評分。'],
  unavailable: [503, '評分暫時不能用，請稍後再試。'],
};

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

// 😀 / 🙁 on an answer, kept on its ask_log row for the admin's 問答紀錄 and Telegram's stats.
// No moderation of the note: only an admin reads it, and it goes with the row after ASK_LOG_DAYS.
export async function POST(req: Request) {
  // Same checks as /api/ask: same-origin JSON only
  if (!req.headers.get('content-type')?.startsWith('application/json')) return json(415, { error: '格式錯誤' });
  const origin = req.headers.get('origin');
  if (origin && new URL(origin).host !== req.headers.get('host')) return json(403, { error: '來源不符' });

  // Signed out, an answer is the visitor's own while their id is the same: that Taipei day
  const userId = (await currentUser())?.id ?? anonVisitor(anonToken(cookieValue(req.headers)), clientAddress(req.headers), taipeiDate())?.id;
  if (!userId) return json(401, { error: '請先登入' });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    // The page sends only what it offers, so the note's length is the one thing a listener can get wrong
    const note = parsed.error.issues.some((i) => i.path[0] === 'note');
    return json(400, { error: note ? `補充說明請在 ${MAX_RATING_NOTE_CHARS} 字以內` : '評分沒有送出，請重新整理頁面再試。' });
  }

  const r = rateAsk(await writeDb(), userId, parsed.data.id, parsed.data);
  if (!r.ok) {
    const [status, error] = REFUSED[r.reason];
    return json(status, { error });
  }
  return json(200, { ok: true });
}
