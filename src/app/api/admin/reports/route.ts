import { z } from 'zod';
import { insertEdits } from '@/lib/admin-edits';
import { reportEpisode, reportHere } from '@/lib/admin-reports';
import { currentAdmin } from '@/lib/auth';
import { getReport, insertSummaryEdit, resolveReport } from '@/lib/reports';
import { readDb, writeDb } from '@/lib/server-db';
import { countInSummary } from '@/lib/summary-edits';
import { cleanSegmentText, replaceMatches, replaceOpen } from '@/lib/transcript-edits';

// here: the paragraph selected (its first segment with the words); episode: every occurrence
// in the transcript; summary: every occurrence in the summary. alsoSummary / alsoTranscript
// add the other one (the transcript as with `episode`). Occurrences already inside the
// suggestion (台積 in 台積電) are left alone everywhere.
const Body = z.object({
  id: z.number().int().positive(),
  action: z.enum(['here', 'episode', 'summary', 'reject']),
  suggestion: z.string().max(200),
  alsoSummary: z.boolean().optional(),
  alsoTranscript: z.boolean().optional(),
});

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

class AlreadyDecided extends Error {}

// An admin's decision on a listener's typo report. Accepting adds transcript_edits and/or
// summary_edits rows (the worker applies them within about 15 seconds) and marks the report,
// and any identical pending ones, accepted; the admin may change the suggestion first.
export async function POST(req: Request) {
  if (!req.headers.get('content-type')?.startsWith('application/json')) return json(415, { error: '格式錯誤' });
  const origin = req.headers.get('origin');
  if (origin && new URL(origin).host !== req.headers.get('host')) return json(403, { error: '來源不符' });
  if (!(await currentAdmin())) return new Response('Not Found', { status: 404 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(400, { error: '格式錯誤' });
  const { id, action, alsoSummary, alsoTranscript } = parsed.data;

  const db = await readDb();
  const wdb = await writeDb();
  const report = getReport(db, id);
  if (!report) return json(404, { error: '找不到這則回報' });
  if (report.status !== 'pending') return json(409, { error: '這則回報已經處理過了' });

  // Decided inside the write transaction: a second tab or a double click finds it decided
  // and writes nothing
  const decide = (status: 'accepted' | 'rejected', suggestion: string, write: () => void) => {
    try {
      wdb.transaction(() => {
        if (!resolveReport(wdb, report, status, suggestion)) throw new AlreadyDecided();
        write();
      })();
      return null;
    } catch (err) {
      if (err instanceof AlreadyDecided) return json(409, { error: '這則回報已經處理過了' });
      throw err;
    }
  };

  if (action === 'reject') return decide('rejected', report.suggestion, () => {}) ?? json(200, { ok: true, message: '已駁回' });

  const suggestion = cleanSegmentText(parsed.data.suggestion);
  if (!suggestion) return json(400, { error: '改成的文字不能是空的' });
  if (suggestion === report.original) return json(400, { error: '改成的文字跟原文一樣' });
  const ep = reportEpisode(db, report.episodeNo);
  if (!ep) return json(409, { error: `EP${report.episodeNo} 不在網站上，只能駁回` });

  const edits: { start: number; oldText: string; newText: string }[] = [];
  if (action === 'here') {
    const here = reportHere(ep, report, suggestion);
    if (!here) return json(409, { error: '這一段找不到原文（可能跨了兩句，或已經改過），請到逐字稿頁手動改' });
    edits.push({ start: here.start, oldText: here.text, newText: replaceOpen(here.text, report.original, suggestion, 1).text });
  } else if (action === 'episode' || alsoTranscript) {
    for (const m of replaceMatches(ep.segments, report.original, suggestion)) {
      edits.push({ start: m.start, oldText: m.oldText, newText: m.newText });
    }
    if (action === 'episode' && !edits.length) return json(409, { error: '這集逐字稿沒有要改的原文' });
  }
  const summary = action === 'summary' || !!alsoSummary;
  const inSummary = countInSummary(ep.summary, report.original, suggestion);
  if (action === 'summary' && !inSummary) return json(409, { error: '這集重點沒有要改的原文' });

  const refused = decide('accepted', suggestion, () => {
    if (edits.length) insertEdits(wdb, ep.id, edits, report.id);
    if (summary && inSummary) insertSummaryEdit(wdb, ep.id, report.original, suggestion, report.id);
  });
  if (refused) return refused;
  const parts = [edits.length && `逐字稿 ${edits.length} 句`, summary && inSummary && `重點 ${inSummary} 處`].filter(Boolean);
  return json(200, { ok: true, message: `已採用：${parts.join('、')}，worker 約 15 秒內套用` });
}
