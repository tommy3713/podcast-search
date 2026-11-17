import OpenAI from 'openai';
import { z } from 'zod';
import { currentUser } from '@/lib/auth';
import {
  addFeedback,
  charCount,
  FEEDBACK_DAILY_LIMIT,
  FEEDBACK_KINDS,
  feedbackToday,
  isDuplicateFeedback,
  isEmail,
  isSitePath,
  MAX_FEEDBACK_CHARS,
} from '@/lib/feedback';
import { refuseCrossSite } from '@/lib/same-origin';
import { writeDb } from '@/lib/server-db';

const Client = z.object({
  ua: z.string().transform((s) => s.slice(0, 300)),
  width: z.number().int().nonnegative().max(100_000),
  height: z.number().int().nonnegative().max(100_000),
  theme: z.enum(['light', 'dark']),
});

const Body = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  body: z
    .string()
    .trim()
    .min(1)
    .refine((s) => charCount(s) <= MAX_FEEDBACK_CHARS),
  // Typed by the listener, only to hear back; blank: none
  email: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((s) => s || null)
    .refine((s) => s === null || isEmail(s)),
  // The path the form was opened on and a bug's browser: context the listener can't change in
  // the form, so one that doesn't fit is dropped rather than refusing their words
  // (.optional(): zod 4 makes a key with a transform required)
  page: z
    .unknown()
    .optional()
    .transform((s) => (typeof s === 'string' && isSitePath(s) ? s : null)),
  client: z
    .unknown()
    .optional()
    .transform((c) => Client.safeParse(c).data ?? null),
});

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

// A listener's feedback, kept for an admin to read in /admin/feedback. Signed-in listeners
// only, FEEDBACK_DAILY_LIMIT a day. Nothing is mailed: an admin answers by hand when there's
// an email.
export async function POST(req: Request) {
  const refused = refuseCrossSite(req);
  if (refused) return refused;

  const user = await currentUser();
  if (!user) return json(401, { error: '請先登入' });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    const error =
      field === 'email' ? 'Email 格式不對，不想收到回覆可以留白' : field === 'kind' ? '請選一個類型' : `內容要填，${MAX_FEEDBACK_CHARS} 字以內`;
    return json(400, { error });
  }
  const f = parsed.data;

  const wdb = await writeDb();
  // Cheap checks first, so a listener at the limit costs no moderation request; addFeedback
  // checks both again with the insert
  if (feedbackToday(wdb, user.id) >= FEEDBACK_DAILY_LIMIT) return json(429, { error: LIMIT });
  if (isDuplicateFeedback(wdb, user.id, f.body)) return json(409, { error: DUPLICATE });

  // Only an admin reads it, so a failed check lets it through rather than turning the
  // listener away; a flagged one is refused
  try {
    const mod = await new OpenAI().moderations.create({ model: 'omni-moderation-latest', input: f.body }, { signal: AbortSignal.timeout(5000) });
    if (mod.results.some((x) => x.flagged)) return json(400, { error: '這個內容無法送出。' });
  } catch (err) {
    console.error('[feedback] moderation', err instanceof Error ? err.message : err);
  }

  const added = addFeedback(wdb, user.id, f);
  if (!added.ok) return added.reason === 'limit' ? json(429, { error: LIMIT }) : json(409, { error: DUPLICATE });
  return json(200, { ok: true, id: added.id, remaining: added.remaining });
}

const LIMIT = `今天已經送出 ${FEEDBACK_DAILY_LIMIT} 則了，明天再來，謝謝！`;
const DUPLICATE = '這則已經送出過了，謝謝！';
