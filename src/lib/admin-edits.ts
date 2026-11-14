import type { DB } from './db.ts';
import type { Segment } from './segments.ts';
import { applyEdits, type TranscriptEdit } from './transcript-edits.ts';

// The admin pages' view of transcript_edits. The web only inserts rows; the worker applies
// them (worker/edits.ts).

export type EditStatus = 'pending' | 'applied' | 'failed';

export type EditRow = {
  id: number;
  episodeNo: number;
  segStart: number;
  oldText: string;
  newText: string;
  createdAt: string;
  status: EditStatus;
  error: string | null;
};

// A segment as the admin page shows it, with the edits still waiting applied (`pending`: one
// of them changed it). Pages and the API refer to segments by index, since two can share a
// start (19 pairs among 300 episodes).
export type AdminSegment = Segment & { pending: boolean };

type Row = {
  id: number;
  episode_no: number;
  seg_start: number;
  old_text: string;
  new_text: string;
  created_at: string;
  applied_at: string | null;
  error: string | null;
};

const SELECT = `SELECT t.id, e.episode_no, t.seg_start, t.old_text, t.new_text, t.created_at, t.applied_at, t.error
  FROM transcript_edits t JOIN episodes e ON e.id = t.episode_id`;

function toRow(r: Row): EditRow {
  return {
    id: r.id,
    episodeNo: r.episode_no,
    segStart: r.seg_start,
    oldText: r.old_text,
    newText: r.new_text,
    createdAt: r.created_at,
    status: r.error ? 'failed' : r.applied_at ? 'applied' : 'pending',
    error: r.error,
  };
}

// The web never migrates, so a snapshot from before the table has to say so rather than crash
export function hasEditsTable(db: DB): boolean {
  return db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'transcript_edits'`).get() !== undefined;
}

export function recentEdits(db: DB, limit: number): EditRow[] {
  return (db.prepare(`${SELECT} ORDER BY t.id DESC LIMIT ?`).all(limit) as Row[]).map(toRow);
}

export type AdminEpisode = { id: number; no: number; title: string; segments: AdminSegment[]; edits: EditRow[] };

// A live episode's transcript as it will read once the pending edits are applied, and all its
// edits, newest first
export function adminEpisode(db: DB, no: number): AdminEpisode | null {
  const ep = db
    .prepare(`SELECT id, episode_no, title, segments_json FROM episodes WHERE status = 'done' AND episode_no = ?`)
    .get(no) as { id: number; episode_no: number; title: string; segments_json: string | null } | undefined;
  if (!ep?.segments_json) return null;
  const edits = (db.prepare(`${SELECT} WHERE t.episode_id = ? ORDER BY t.id DESC`).all(ep.id) as Row[]).map(toRow);
  const pending: TranscriptEdit[] = edits
    .filter((e) => e.status === 'pending')
    .reverse()
    .map((e) => ({ id: e.id, segStart: e.segStart, oldText: e.oldText, newText: e.newText }));
  const { segments, results } = applyEdits(JSON.parse(ep.segments_json) as Segment[], pending);
  const touched = new Set(results.flatMap((r) => (r.index === undefined ? [] : [r.index])));
  return {
    id: ep.id,
    no: ep.episode_no,
    title: ep.title,
    segments: segments.map((s, i) => ({ ...s, pending: touched.has(i) })),
    edits,
  };
}

// reportId: the listener's report they come from (typo_reports), if any. Run inside the
// caller's transaction when it has one.
export function insertEdits(
  db: DB,
  episodeId: number,
  edits: { start: number; oldText: string; newText: string }[],
  reportId: number | null = null,
): void {
  const ins = db.prepare('INSERT INTO transcript_edits (episode_id, seg_start, old_text, new_text, report_id) VALUES (?, ?, ?, ?, ?)');
  db.transaction(() => {
    for (const e of edits) ins.run(episodeId, e.start, e.oldText, e.newText, reportId);
  })();
}
