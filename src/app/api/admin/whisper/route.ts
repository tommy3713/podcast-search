import { z } from 'zod';
import { currentAdmin } from '@/lib/auth';
import { readDb, writeDb } from '@/lib/server-db';
import { currentPrompt, hasPromptsTable, savePrompt } from '@/lib/whisper/prompts';
import { WHISPER_PROMPT_TOKENS, whisperTokens } from '@/lib/whisper/tokens';

const Body = z.object({
  action: z.enum(['count', 'save']),
  // A prompt over the limit is long before this; capped so counting stays quick
  text: z.string().max(1000),
});

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

// count: the prompt's tokens as Whisper reads them (the editor asks as the admin types);
// save: a new version, which the worker uses from the next transcription on. One over
// WHISPER_PROMPT_TOKENS is refused: Whisper would silently drop its beginning.
export async function POST(req: Request) {
  if (!req.headers.get('content-type')?.startsWith('application/json')) return json(415, { error: '格式錯誤' });
  const origin = req.headers.get('origin');
  if (origin && new URL(origin).host !== req.headers.get('host')) return json(403, { error: '來源不符' });
  if (!(await currentAdmin())) return new Response('Not Found', { status: 404 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(400, { error: '格式錯誤' });
  const text = parsed.data.text.replace(/\s+/g, ' ').trim();
  const tokens = whisperTokens(text);
  if (parsed.data.action === 'count') return json(200, { tokens, limit: WHISPER_PROMPT_TOKENS });

  if (!text) return json(400, { error: '提示詞不能是空的' });
  if (tokens > WHISPER_PROMPT_TOKENS) return json(400, { error: `${tokens} 個 token，超過 ${WHISPER_PROMPT_TOKENS} 個上限` });
  const db = await readDb();
  if (!hasPromptsTable(db)) return json(503, { error: '資料庫還沒有 whisper_prompts 表，請先跑 worker migrate' });
  if (text === currentPrompt(db)) return json(400, { error: '跟目前的版本一樣' });
  const id = savePrompt(await writeDb(), text);
  return json(200, { ok: true, id, tokens });
}
