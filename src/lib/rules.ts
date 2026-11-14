import { adminEpisode, insertEdits, insertSummaryEdit } from './admin-edits.ts';
import type { DB } from './db.ts';
import { charCount } from './report-limits.ts';
import type { Segment } from './segments.ts';
import type { Summary } from './summary.ts';
import { countInSummary } from './summary-edits.ts';
import { replaceMatches } from './transcript-edits.ts';

// Rules for mishearings (text_fixes): the worker applies the enabled ones to every new
// transcript (worker/text.ts normalizeText); /admin/rules edits them and can apply one to
// episodes already live, as transcript_edits / summary_edits rows the worker applies like any
// edit. A rule replaces its words wherever they are, with no look at the context, so the
// preview lists every place before it is applied.

export type Rule = { id: number; original: string; replacement: string; note: string | null; enabled: boolean; createdAt: string; updatedAt: string };

// Shorter words are too likely to be part of other words; 2 characters are allowed (谷海 →
// 股癌 is one), with a warning on the page under 3
export const MIN_RULE_CHARS = 2;
export const MAX_RULE_CHARS = 30;
// What re-indexing one episode costs (embedding its chunks again), for the page's estimate
export const REINDEX_USD = 0.0005;

type Row = { id: number; original: string; replacement: string; note: string | null; enabled: number; created_at: string; updated_at: string };
const toRule = (r: Row): Rule => ({
  id: r.id,
  original: r.original,
  replacement: r.replacement,
  note: r.note,
  enabled: r.enabled === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function hasRulesTable(db: DB): boolean {
  return db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'text_fixes'`).get() !== undefined;
}

// Enabled ones first, then in the order they were added
export function listRules(db: DB): Rule[] {
  return (db.prepare('SELECT * FROM text_fixes ORDER BY enabled DESC, id').all() as Row[]).map(toRule);
}

export function getRule(db: DB, id: number): Rule | null {
  const r = db.prepare('SELECT * FROM text_fixes WHERE id = ?').get(id) as Row | undefined;
  return r ? toRule(r) : null;
}

// Why a rule can't be saved, or null
export function checkRule(original: string, replacement: string): string | null {
  if (charCount(original) < MIN_RULE_CHARS) return `錯字至少要 ${MIN_RULE_CHARS} 個字`;
  if (charCount(original) > MAX_RULE_CHARS || charCount(replacement) > MAX_RULE_CHARS) return `錯字和改成的字都要在 ${MAX_RULE_CHARS} 字以內`;
  if (!replacement) return '改成的字不能是空的';
  if (original === replacement) return '改成的字跟錯字一樣';
  return null;
}

type RuleInput = { original: string; replacement: string; note: string | null; enabled: boolean };

// With an id, updates that rule (its words too); without, adds one, or updates the one with
// the same words. Its id, or null when an edit's new words belong to another rule.
export function saveRule(db: DB, r: RuleInput & { id?: number }): number | null {
  if (r.id !== undefined) {
    const other = db.prepare('SELECT id FROM text_fixes WHERE original = ? AND id != ?').get(r.original, r.id);
    if (other) return null;
    const changed = db
      .prepare(
        `UPDATE text_fixes SET original = ?, replacement = ?, note = ?, enabled = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`,
      )
      .run(r.original, r.replacement, r.note, r.enabled ? 1 : 0, r.id).changes;
    return changed ? r.id : null;
  }
  return (
    db
      .prepare(
        `INSERT INTO text_fixes (original, replacement, note, enabled) VALUES (?, ?, ?, ?)
         ON CONFLICT (original) DO UPDATE SET replacement = excluded.replacement, note = excluded.note, enabled = excluded.enabled,
           updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
         RETURNING id`,
      )
      .get(r.original, r.replacement, r.note, r.enabled ? 1 : 0) as { id: number }
  ).id;
}

export function setRuleEnabled(db: DB, id: number, enabled: boolean): boolean {
  return (
    db.prepare(`UPDATE text_fixes SET enabled = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`).run(enabled ? 1 : 0, id).changes > 0
  );
}

// Edits it already queued stay (they are ordinary edits now; undo one in the transcript editor)
export function deleteRule(db: DB, id: number): boolean {
  return db.prepare('DELETE FROM text_fixes WHERE id = ?').run(id).changes > 0;
}

// ── applying a rule to episodes already live ───────────────────────────────────

export type RuleEpisode = {
  no: number;
  title: string;
  // Occurrences the rule would change (replaceOpen: not those already inside the replacement)
  // and the segments they're in, in the transcript as it will read with pending edits
  count: number;
  segments: number;
  summaryCount: number;
  // A few of the segments, before the change
  samples: { start: number; text: string }[];
};

type Plan = RuleEpisode & { id: number; edits: { start: number; oldText: string; newText: string }[] };

type Candidate = { id: number; episode_no: number; title: string; segments_json: string; summary_json: string | null; pending: number };

// Live episodes whose stored transcript or summary has the words, found by one scan of the
// JSON in SQLite (no parsing in JavaScript for the rest), newest first. Episodes with pending
// edits are read as they will be once those apply (adminEpisode); others as stored.
function plans(db: DB, original: string, replacement: string, only?: number[]): Plan[] {
  const rows = db
    .prepare(
      `SELECT e.id, e.episode_no, e.title, e.segments_json, e.summary_json,
         EXISTS (SELECT 1 FROM transcript_edits t WHERE t.episode_id = e.id AND t.applied_at IS NULL AND t.error IS NULL) AS pending
       FROM episodes e
       WHERE e.status = 'done' AND e.segments_json IS NOT NULL
         AND (instr(e.segments_json, @w) > 0 OR instr(e.summary_json, @w) > 0 OR EXISTS (
           SELECT 1 FROM transcript_edits t WHERE t.episode_id = e.id AND t.applied_at IS NULL AND t.error IS NULL AND instr(t.new_text, @w) > 0))
         ${only ? 'AND e.episode_no IN (SELECT value FROM json_each(@only))' : ''}
       ORDER BY e.episode_no DESC`,
    )
    .all({ w: original, ...(only ? { only: JSON.stringify(only) } : {}) }) as Candidate[];
  return rows.flatMap((r) => {
    const segments = r.pending ? (adminEpisode(db, r.episode_no)?.segments ?? []) : (JSON.parse(r.segments_json) as Segment[]);
    const matches = replaceMatches(segments, original, replacement);
    const summaryCount = r.summary_json ? countInSummary(JSON.parse(r.summary_json) as Summary, original, replacement) : 0;
    if (!matches.length && !summaryCount) return [];
    return [
      {
        id: r.id,
        no: r.episode_no,
        title: r.title,
        count: matches.reduce((n, m) => n + m.count, 0),
        segments: matches.length,
        summaryCount,
        samples: matches.slice(0, 3).map((m) => ({ start: m.start, text: m.oldText })),
        edits: matches.map((m) => ({ start: m.start, oldText: m.oldText, newText: m.newText })),
      },
    ];
  });
}

// Every live episode the rule would change, newest first
export function previewRule(db: DB, original: string, replacement: string): RuleEpisode[] {
  return plans(db, original, replacement).map(({ id: _id, edits: _edits, ...e }) => e);
}

// Turns a rule into edits of the chosen episodes (the transcript, and the summary too when
// `summary`), worked out the same way as the preview, in one transaction. How many episodes,
// segments and summary occurrences it queued.
export function applyRule(
  db: DB,
  rule: { id: number; original: string; replacement: string },
  episodes: number[],
  summary: boolean,
): { episodes: number; segments: number; summary: number } {
  if (!episodes.length) return { episodes: 0, segments: 0, summary: 0 };
  const todo = plans(db, rule.original, rule.replacement, episodes).filter((p) => p.edits.length || (summary && p.summaryCount));
  db.transaction(() => {
    for (const p of todo) {
      if (p.edits.length) insertEdits(db, p.id, p.edits, { fixId: rule.id });
      if (summary && p.summaryCount) insertSummaryEdit(db, p.id, rule.original, rule.replacement, { fixId: rule.id });
    }
  })();
  return {
    episodes: todo.length,
    segments: todo.reduce((n, p) => n + p.edits.length, 0),
    summary: summary ? todo.reduce((n, p) => n + p.summaryCount, 0) : 0,
  };
}
