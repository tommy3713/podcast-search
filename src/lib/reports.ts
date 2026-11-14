import { taipeiDate, taipeiDayStart } from './ask/quota.ts';
import { type DB, toDbTime } from './db.ts';
import { groupParagraphs, paragraphStarts } from './format.ts';
import { ftsPhrase } from './fts.ts';
import { charCount, REPORT_DAILY_LIMIT } from './report-limits.ts';
import type { Segment } from './segments.ts';
import type { Summary } from './summary.ts';
import type { ReportTarget } from './report-limits.ts';
import { countInSummary } from './summary-edits.ts';

// Listeners' typo reports: a signed-in listener selects words in an episode's transcript or
// summary and says what they should be; an admin accepts (as transcript_edits / summary_edits)
// or rejects them in /admin/reports. Nothing changes on the site until an admin accepts.

export { charCount, MAX_NOTE_CHARS, MAX_REPORT_CHARS, REPORT_DAILY_LIMIT, type ReportTarget } from './report-limits.ts';
export type ReportStatus = 'pending' | 'accepted' | 'rejected';

export type NewReport = {
  episode: number;
  target: ReportTarget;
  // transcript: the start of the paragraph the words were selected in
  at: number | null;
  original: string;
  suggestion: string;
  note: string | null;
};

type LiveEpisode = { id: number; segments: Segment[]; summary: Summary };

function liveEpisode(db: DB, no: number): LiveEpisode | null {
  const r = db
    .prepare(`SELECT id, segments_json, summary_json FROM episodes WHERE status = 'done' AND episode_no = ?`)
    .get(no) as { id: number; segments_json: string | null; summary_json: string | null } | undefined;
  if (!r?.segments_json || !r.summary_json) return null;
  return { id: r.id, segments: JSON.parse(r.segments_json) as Segment[], summary: JSON.parse(r.summary_json) as Summary };
}

// The indexes of the segments making up the paragraph that starts at `at`, as the episode
// page groups them (groupParagraphs); empty when no paragraph starts there
export function paragraphSegments(segments: Segment[], at: number): number[] {
  return paragraphStarts(segments).flatMap((start, i) => (start === at ? [i] : []));
}

// Checks a report names words that are where it says, in a live episode. The episode's id,
// or why not.
export function checkReport(db: DB, r: NewReport): { ok: true; episodeId: number } | { ok: false; error: string } {
  const ep = liveEpisode(db, r.episode);
  if (!ep) return { ok: false, error: `EP${r.episode} 不在網站上` };
  if (r.target === 'transcript') {
    if (r.at === null) return { ok: false, error: '缺少段落時間' };
    const para = groupParagraphs(ep.segments).find((p) => p.start === r.at);
    if (!para) return { ok: false, error: '找不到這一段，請重新整理頁面再選一次' };
    if (!para.text.includes(r.original)) return { ok: false, error: '這一段沒有選取的文字，請重新整理頁面再選一次' };
  } else if (!countInSummary(ep.summary, r.original)) {
    return { ok: false, error: '重點裡沒有選取的文字，請重新整理頁面再選一次' };
  }
  return { ok: true, episodeId: ep.id };
}

// Reports this account sent today (Taipei day), for REPORT_DAILY_LIMIT
export function reportsToday(db: DB, userId: string, now = new Date()): number {
  const since = toDbTime(taipeiDayStart(taipeiDate(now)));
  return (db.prepare('SELECT COUNT(*) AS n FROM typo_reports WHERE user_id = ? AND created_at >= ?').get(userId, since) as { n: number }).n;
}

// The same account already reported the same change and it's still waiting
export function isDuplicate(db: DB, userId: string, episodeId: number, r: NewReport): boolean {
  return (
    db
      .prepare(
        `SELECT 1 FROM typo_reports WHERE user_id = ? AND episode_id = ? AND target = ? AND original = ? AND suggestion = ? AND status = 'pending'`,
      )
      .get(userId, episodeId, r.target, r.original, r.suggestion) !== undefined
  );
}

// Saves a report unless the account is at its daily limit or sent the same one already, both
// checked in the same transaction as the insert, so requests sent at once can't all get in.
// How many it may still send today, or why not.
export function addReport(
  db: DB,
  userId: string,
  episodeId: number,
  r: NewReport,
  now = new Date(),
): { ok: true; remaining: number } | { ok: false; reason: 'limit' | 'duplicate' } {
  return db.transaction(() => {
    const used = reportsToday(db, userId, now);
    if (used >= REPORT_DAILY_LIMIT) return { ok: false as const, reason: 'limit' as const };
    if (isDuplicate(db, userId, episodeId, r)) return { ok: false as const, reason: 'duplicate' as const };
    db.prepare(`INSERT INTO typo_reports (episode_id, target, at_sec, original, suggestion, note, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      episodeId,
      r.target,
      r.target === 'transcript' ? r.at : null,
      r.original,
      r.suggestion,
      r.note,
      userId,
    );
    return { ok: true as const, remaining: REPORT_DAILY_LIMIT - used - 1 };
  }).immediate();
}

// ── admin ────────────────────────────────────────────────────────────────────

export type AdminReport = {
  id: number;
  episodeId: number;
  episodeNo: number;
  target: ReportTarget;
  at: number | null;
  original: string;
  suggestion: string;
  note: string | null;
  status: ReportStatus;
  createdAt: string;
  resolvedAt: string | null;
  // Other pending reports of the same change (same episode, target and words)
  same: number;
};

type Row = {
  id: number;
  episode_id: number;
  episode_no: number;
  target: ReportTarget;
  at_sec: number | null;
  original: string;
  suggestion: string;
  note: string | null;
  status: ReportStatus;
  created_at: string;
  resolved_at: string | null;
  same: number;
};

const SELECT = `SELECT r.id, r.episode_id, e.episode_no, r.target, r.at_sec, r.original, r.suggestion, r.note, r.status,
    r.created_at, r.resolved_at,
    (SELECT COUNT(*) FROM typo_reports o WHERE o.id != r.id AND o.status = 'pending' AND o.episode_id = r.episode_id
       AND o.target = r.target AND o.original = r.original AND o.suggestion = r.suggestion) AS same
  FROM typo_reports r JOIN episodes e ON e.id = r.episode_id`;

const toReport = (r: Row): AdminReport => ({
  id: r.id,
  episodeId: r.episode_id,
  episodeNo: r.episode_no,
  target: r.target,
  at: r.at_sec,
  original: r.original,
  suggestion: r.suggestion,
  note: r.note,
  status: r.status,
  createdAt: r.created_at,
  resolvedAt: r.resolved_at,
  same: r.same,
});

export function hasReportsTable(db: DB): boolean {
  return db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'typo_reports'`).get() !== undefined;
}

// Waiting ones oldest first; of identical pending reports only the oldest is listed (`same`
// counts the others)
export function pendingReports(db: DB): AdminReport[] {
  return (
    db
      .prepare(
        `${SELECT} WHERE r.status = 'pending' AND NOT EXISTS (
           SELECT 1 FROM typo_reports o WHERE o.id < r.id AND o.status = 'pending' AND o.episode_id = r.episode_id
             AND o.target = r.target AND o.original = r.original AND o.suggestion = r.suggestion)
         ORDER BY r.id`,
      )
      .all() as Row[]
  ).map(toReport);
}

export function resolvedReports(db: DB, limit: number): AdminReport[] {
  return (db.prepare(`${SELECT} WHERE r.status != 'pending' ORDER BY r.resolved_at DESC, r.id DESC LIMIT ?`).all(limit) as Row[]).map(toReport);
}

export function getReport(db: DB, id: number): AdminReport | null {
  const r = db.prepare(`${SELECT} WHERE r.id = ?`).get(id) as Row | undefined;
  return r ? toReport(r) : null;
}

export function countPendingReports(db: DB): number {
  if (!hasReportsTable(db)) return 0;
  return (db.prepare(`SELECT COUNT(*) AS n FROM typo_reports WHERE status = 'pending'`).get() as { n: number }).n;
}

// Marks a pending report, and the identical pending ones, resolved, with the suggestion the
// admin used. False when the report wasn't pending (decided in another tab meanwhile): then
// nothing changes. Run inside the transaction that writes what the decision adds.
export function resolveReport(db: DB, r: AdminReport, status: 'accepted' | 'rejected', suggestion: string): boolean {
  const stamp = `resolved_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`;
  const own = db.prepare(`UPDATE typo_reports SET status = ?, suggestion = ?, ${stamp} WHERE id = ? AND status = 'pending'`).run(status, suggestion, r.id);
  if (!own.changes) return false;
  db.prepare(
    `UPDATE typo_reports SET status = ?, ${stamp}
     WHERE status = 'pending' AND episode_id = ? AND target = ? AND original = ? AND suggestion = ?`,
  ).run(status, r.episodeId, r.target, r.original, r.suggestion);
  return true;
}


// Live episodes whose transcript has the words, for a rule across episodes (an admin hint).
// Through the trigram index when the words are long enough for it (3+ characters), like the
// Q&A's keyword search; shorter ones scan the chunks.
export function episodesWith(db: DB, words: string): number {
  const short = charCount(words) < 3;
  const sql = short
    ? `SELECT COUNT(DISTINCT c.episode_id) AS n FROM chunks c JOIN episodes e ON e.id = c.episode_id
       WHERE e.status = 'done' AND instr(c.text, ?) > 0`
    : `SELECT COUNT(DISTINCT c.episode_id) AS n FROM chunks_fts f JOIN chunks c ON c.id = f.rowid JOIN episodes e ON e.id = c.episode_id
       WHERE chunks_fts MATCH ? AND e.status = 'done'`;
  return (db.prepare(sql).get(short ? words : ftsPhrase(words)) as { n: number }).n;
}

