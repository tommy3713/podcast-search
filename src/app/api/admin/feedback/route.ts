import { z } from 'zod';
import { currentAdmin } from '@/lib/auth';
import { FEEDBACK_STATUSES, updateFeedback } from '@/lib/feedback';
import { refuseCrossSite } from '@/lib/same-origin';
import { writeDb } from '@/lib/server-db';

const Body = z.object({
  id: z.number().int().positive(),
  status: z.enum(FEEDBACK_STATUSES).optional(),
  // Blank clears it
  note: z
    .string()
    .max(2000)
    .optional()
    .transform((s) => (s === undefined ? undefined : s.trim() || null)),
});

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

// An admin's status and private note on a listener's feedback
export async function POST(req: Request) {
  const refused = refuseCrossSite(req);
  if (refused) return refused;
  if (!(await currentAdmin())) return new Response('Not Found', { status: 404 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(400, { error: '格式錯誤' });
  const { id, status, note } = parsed.data;
  if (!updateFeedback(await writeDb(), id, { status, note })) return json(404, { error: '找不到這則回饋' });
  return json(200, { ok: true });
}
