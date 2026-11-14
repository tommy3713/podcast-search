import { z } from 'zod';
import { currentAdmin } from '@/lib/auth';
import { applyRule, checkRule, deleteRule, hasRulesTable, previewRule, REINDEX_USD, saveRule, setRuleEnabled } from '@/lib/rules';
import { readDb, writeDb } from '@/lib/server-db';
import { cleanSegmentText } from '@/lib/transcript-edits';

const words = z.string().max(200).transform(cleanSegmentText);
const id = z.number().int().positive();

const Body = z.discriminatedUnion('action', [
  // Every live episode the rule would change
  z.object({ action: z.literal('preview'), original: words, replacement: words }),
  // Adds a rule (or, with an id, updates that one, its words too) for new transcripts, and
  // applies it to the episodes listed
  z.object({
    action: z.literal('save'),
    id: id.optional(),
    original: words,
    replacement: words,
    note: z.string().max(200).nullable().optional(),
    enabled: z.boolean(),
    episodes: z.array(z.number().int().positive()).max(5000),
    summary: z.boolean(),
  }),
  z.object({ action: z.literal('enable'), id, enabled: z.boolean() }),
  z.object({ action: z.literal('delete'), id }),
]);

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

export async function POST(req: Request) {
  if (!req.headers.get('content-type')?.startsWith('application/json')) return json(415, { error: '格式錯誤' });
  const origin = req.headers.get('origin');
  if (origin && new URL(origin).host !== req.headers.get('host')) return json(403, { error: '來源不符' });
  if (!(await currentAdmin())) return new Response('Not Found', { status: 404 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(400, { error: '格式錯誤' });
  const b = parsed.data;
  const db = await readDb();
  if (!hasRulesTable(db)) return json(503, { error: '資料庫還沒有 text_fixes 表，請先跑 worker migrate' });

  if (b.action === 'enable') {
    if (!setRuleEnabled(await writeDb(), b.id, b.enabled)) return json(404, { error: '找不到這條規則' });
    return json(200, { ok: true });
  }
  if (b.action === 'delete') {
    if (!deleteRule(await writeDb(), b.id)) return json(404, { error: '找不到這條規則' });
    return json(200, { ok: true });
  }

  const invalid = checkRule(b.original, b.replacement);
  if (invalid) return json(400, { error: invalid });
  if (b.action === 'preview') return json(200, { episodes: previewRule(db, b.original, b.replacement), usdPerEpisode: REINDEX_USD });

  const wdb = await writeDb();
  const saved = saveRule(wdb, { id: b.id, original: b.original, replacement: b.replacement, note: b.note?.trim() || null, enabled: b.enabled });
  if (saved === null) return json(409, { error: b.id ? '已經有一條規則用這個錯字了，或這條規則已被刪除' : '儲存失敗' });
  const applied = applyRule(wdb, { id: saved, original: b.original, replacement: b.replacement }, b.episodes, b.summary);
  return json(200, { ok: true, id: saved, applied });
}
