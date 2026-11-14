import type { DB } from '../db.ts';
import { WHISPER_PROMPT } from './default-prompt.ts';

// The Whisper prompt's versions (whisper_prompts), as /admin/whisper shows and saves them.
// The newest row is the one the worker uses for the next transcription; none: the built-in one.

export type PromptVersion = {
  // null: the built-in prompt (WHISPER_PROMPT)
  id: number | null;
  text: string;
  createdAt: string | null;
  // Live episodes transcribed with it (for the built-in one: also those from before this
  // was recorded)
  episodes: number;
  current: boolean;
};

export function hasPromptsTable(db: DB): boolean {
  return db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'whisper_prompts'`).get() !== undefined;
}

// Newest first, the built-in one last
export function promptVersions(db: DB): PromptVersion[] {
  const rows = db.prepare('SELECT id, text, created_at FROM whisper_prompts ORDER BY id DESC').all() as { id: number; text: string; created_at: string }[];
  const counts = new Map(
    (
      db.prepare(`SELECT whisper_prompt_id AS id, COUNT(*) AS n FROM episodes WHERE status = 'done' GROUP BY whisper_prompt_id`).all() as {
        id: number | null;
        n: number;
      }[]
    ).map((c) => [c.id, c.n]),
  );
  return [
    ...rows.map((r, i) => ({ id: r.id, text: r.text, createdAt: r.created_at, episodes: counts.get(r.id) ?? 0, current: i === 0 })),
    { id: null, text: WHISPER_PROMPT, createdAt: null, episodes: counts.get(null) ?? 0, current: rows.length === 0 },
  ];
}

// The prompt the next transcription uses: the newest saved one (id null: none saved, the
// built-in one). The worker reads it through this too (worker/repo.ts transcriptionSettings).
export function currentPromptVersion(db: DB): { id: number | null; text: string } {
  const row = db.prepare('SELECT id, text FROM whisper_prompts ORDER BY id DESC LIMIT 1').get() as { id: number; text: string } | undefined;
  return row ?? { id: null, text: WHISPER_PROMPT };
}

export function currentPrompt(db: DB): string {
  return currentPromptVersion(db).text;
}

export function savePrompt(db: DB, text: string): number {
  return Number(db.prepare('INSERT INTO whisper_prompts (text) VALUES (?)').run(text).lastInsertRowid);
}
