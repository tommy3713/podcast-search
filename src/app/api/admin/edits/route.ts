import { z } from 'zod';
import { adminEpisode, hasEditsTable, insertEdits } from '@/lib/admin-edits';
import { currentAdmin } from '@/lib/auth';
import { readDb, writeDb } from '@/lib/server-db';
import { cleanSegmentText, MAX_SEGMENT_CHARS } from '@/lib/transcript-edits';

const Body = z.object({
  episode: z.number().int().positive(),
  edits: z
    .array(
      z.object({
        // The segment's place in the transcript: two segments can share a start
        index: z.number().int().nonnegative(),
        start: z.number().nonnegative(),
        oldText: z.string().max(MAX_SEGMENT_CHARS),
        newText: z.string().max(MAX_SEGMENT_CHARS),
      }),
    )
    .min(1)
    .max(2000),
});

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

// Queues transcript edits for the worker (worker/edits.ts), which applies and re-indexes them
// within about 15 seconds. Each edit must name a segment as the admin page showed it (the
// transcript with the edits still pending applied), so an edit made on a stale page is refused.
export async function POST(req: Request) {
  // Same checks as /api/ask: same-origin JSON only
  if (!req.headers.get('content-type')?.startsWith('application/json')) return json(415, { error: '格式錯誤' });
  const origin = req.headers.get('origin');
  if (origin && new URL(origin).host !== req.headers.get('host')) return json(403, { error: '來源不符' });
  // Not an admin (or not signed in): the route doesn't exist
  if (!(await currentAdmin())) return new Response('Not Found', { status: 404 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(400, { error: '格式錯誤' });
  const { episode, edits } = parsed.data;

  const db = await readDb();
  if (!hasEditsTable(db)) return json(503, { error: '資料庫還沒有 transcript_edits 表，請先跑 worker migrate' });
  const ep = adminEpisode(db, episode);
  if (!ep) return json(404, { error: `EP${episode} 不在網站上` });

  const seen = new Set<number>();
  const rows: { start: number; oldText: string; newText: string }[] = [];
  for (const e of edits) {
    if (seen.has(e.index)) return json(400, { error: '同一句送了兩次' });
    seen.add(e.index);
    const seg = ep.segments[e.index];
    if (seg?.start !== e.start || seg.text !== e.oldText) {
      return json(409, { error: '逐字稿已經變了，請重新整理頁面再改' });
    }
    const newText = cleanSegmentText(e.newText);
    // Transcription never keeps an empty segment, and chunking would join around it
    if (!newText) return json(400, { error: '句子不能是空的' });
    if (newText !== e.oldText) rows.push({ start: e.start, oldText: e.oldText, newText });
  }
  if (!rows.length) return json(400, { error: '沒有要改的地方' });
  insertEdits(await writeDb(), ep.id, rows);
  return json(200, { ok: true, count: rows.length });
}
