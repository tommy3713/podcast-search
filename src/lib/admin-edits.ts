import { type DB, hasColumn } from './db.ts';
import { parseSeekTable, type SeekTable } from './seek.ts';
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

export type AdminEpisode = {
  id: number;
  no: number;
  title: string;
  // For the page's player, which plays the episode the way the public one does
  audioUrl: string;
  duration: number;
  seek: SeekTable | null;
  segments: AdminSegment[];
  edits: EditRow[];
};

type EpisodeRow = {
  id: number;
  episode_no: number;
  title: string;
  audio_url: string;
  duration: number | null;
  seek_json: string | null;
  segments_json: string | null;
};

// A live episode's transcript as it will read once the pending edits are applied, and all its
// edits, newest first
export function adminEpisode(db: DB, no: number): AdminEpisode | null {
  // An older snapshot has no seek_json: the player then plays without correcting seeks
  const seek = hasColumn(db, 'episodes', 'seek_json') ? 'seek_json' : 'NULL AS seek_json';
  const ep = db
    .prepare(
      `SELECT id, episode_no, title, audio_url, duration, ${seek}, segments_json FROM episodes WHERE status = 'done' AND episode_no = ?`,
    )
    .get(no) as EpisodeRow | undefined;
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
    audioUrl: ep.audio_url,
    // 0 too: a feed's 0 would clamp every seek to the start
    duration: ep.duration || (segments.at(-1)?.end ?? 0),
    seek: parseSeekTable(ep.seek_json),
    segments: segments.map((s, i) => ({ ...s, pending: touched.has(i) })),
    edits,
  };
}

// Where an edit came from, when not typed in the editor: a listener's report (typo_reports)
// or a rule applied to episodes already live (text_fixes)
export type EditSource = { reportId?: number; fixId?: number };

// Run inside the caller's transaction when it has one
export function insertEdits(db: DB, episodeId: number, edits: { start: number; oldText: string; newText: string }[], from: EditSource = {}): void {
  const ins = db.prepare(
    'INSERT INTO transcript_edits (episode_id, seg_start, old_text, new_text, report_id, fix_id) VALUES (?, ?, ?, ?, ?, ?)',
  );
  db.transaction(() => {
    for (const e of edits) ins.run(episodeId, e.start, e.oldText, e.newText, from.reportId ?? null, from.fixId ?? null);
  })();
}

export function insertSummaryEdit(db: DB, episodeId: number, oldText: string, newText: string, from: EditSource = {}): void {
  db.prepare('INSERT INTO summary_edits (episode_id, old_text, new_text, report_id, fix_id) VALUES (?, ?, ?, ?, ?)').run(
    episodeId,
    oldText,
    newText,
    from.reportId ?? null,
    from.fixId ?? null,
  );
}
