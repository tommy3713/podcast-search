import OpenAI from 'openai';
import { z } from 'zod';
import { currentUser } from '@/lib/auth';
import {
  addReport,
  charCount,
  checkReport,
  isDuplicate,
  MAX_NOTE_CHARS,
  MAX_REPORT_CHARS,
  REPORT_DAILY_LIMIT,
  reportsToday,
} from '@/lib/reports';
import { readDb, writeDb } from '@/lib/server-db';

const words = z
  .string()
  .trim()
  .min(1)
  .refine((s) => charCount(s) <= MAX_REPORT_CHARS);

const Body = z.object({
  episode: z.number().int().positive(),
  target: z.enum(['transcript', 'summary']),
  at: z.number().nonnegative().nullable(),
  original: words,
  suggestion: words,
  note: z
    .string()
    .trim()
    .refine((s) => charCount(s) <= MAX_NOTE_CHARS)
    .nullable()
    .optional(),
});

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

// A listener's typo report: kept for an admin to accept or reject in /admin/reports, nothing
// changes on the site until then. Signed-in listeners only, REPORT_DAILY_LIMIT a day.
export async function POST(req: Request) {
  // Same checks as /api/ask: same-origin JSON only
  if (!req.headers.get('content-type')?.startsWith('application/json')) return json(415, { error: '格式錯誤' });
  const origin = req.headers.get('origin');
  if (origin && new URL(origin).host !== req.headers.get('host')) return json(403, { error: '來源不符' });

  const user = await currentUser();
  if (!user) return json(401, { error: '請先登入' });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(400, { error: `原文和建議都要填，各 ${MAX_REPORT_CHARS} 字以內；備註 ${MAX_NOTE_CHARS} 字以內` });
  const r = { ...parsed.data, note: parsed.data.note || null };
  if (r.original === r.suggestion) return json(400, { error: '建議的寫法跟原文一樣' });

  const checked = checkReport(await readDb(), r);
  if (!checked.ok) return json(400, { error: checked.error });

  const wdb = await writeDb();
  // Cheap checks first, so a listener at the limit costs no moderation request; addReport
  // checks both again with the insert
  if (reportsToday(wdb, user.id) >= REPORT_DAILY_LIMIT) return json(429, { error: LIMIT });
  if (isDuplicate(wdb, user.id, checked.episodeId, r)) return json(409, { error: DUPLICATE });

  // Only an admin reads reports, so a failed check lets one through rather than turning the
  // listener away; a flagged one is refused
  try {
    const mod = await new OpenAI().moderations.create(
      { model: 'omni-moderation-latest', input: [r.suggestion, r.note].filter(Boolean).join('\n') },
      { signal: AbortSignal.timeout(5000) },
    );
    if (mod.results.some((x) => x.flagged)) return json(400, { error: '這個內容無法送出。' });
  } catch (err) {
    console.error('[report] moderation', err instanceof Error ? err.message : err);
  }

  const added = addReport(wdb, user.id, checked.episodeId, r);
  if (!added.ok) return added.reason === 'limit' ? json(429, { error: LIMIT }) : json(409, { error: DUPLICATE });
  return json(200, { ok: true, remaining: added.remaining });
}

const LIMIT = `今天已經回報 ${REPORT_DAILY_LIMIT} 次了，明天再來，謝謝！`;
const DUPLICATE = '這個你已經回報過了，謝謝！';
