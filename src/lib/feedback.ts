import { taipeiDate, taipeiDayStart } from './ask/quota.ts';
import { type DB, hasTable, toDbTime } from './db.ts';
import { FEEDBACK_DAILY_LIMIT, type FeedbackKind, type FeedbackStatus, KIND_LABEL } from './feedback-limits.ts';

// Listeners' feedback: a bug, a wish or anything else, sent from the header's button by a
// signed-in listener, with an email only when they want to hear back. The site never sends
// mail: an admin reads it in /admin/feedback and answers from their own mail, by hand.

export * from './feedback-limits.ts';

export type ClientInfo = { ua: string; width: number; height: number; theme: string };

export type NewFeedback = {
  kind: FeedbackKind;
  body: string;
  email: string | null;
  page: string | null;
  client: ClientInfo | null;
};

// Feedback this account sent today (Taipei day), for FEEDBACK_DAILY_LIMIT
export function feedbackToday(db: DB, userId: string, now = new Date()): number {
  const since = toDbTime(taipeiDayStart(taipeiDate(now)));
  return (db.prepare('SELECT COUNT(*) AS n FROM feedback WHERE user_id = ? AND created_at >= ?').get(userId, since) as { n: number }).n;
}

// The same account sent these words and they're still unread (a double click, or a resend
// after an error); once an admin has marked them, the same words may come again
export function isDuplicateFeedback(db: DB, userId: string, body: string): boolean {
  return db.prepare(`SELECT 1 FROM feedback WHERE user_id = ? AND body = ? AND status = 'new'`).get(userId, body) !== undefined;
}

// Saves feedback unless the account is at its daily limit or sent the same words already,
// both checked in the insert's transaction, so requests sent at once can't all get in
export function addFeedback(
  db: DB,
  userId: string,
  f: NewFeedback,
  now = new Date(),
): { ok: true; id: number; remaining: number } | { ok: false; reason: 'limit' | 'duplicate' } {
  return db.transaction(() => {
    const used = feedbackToday(db, userId, now);
    if (used >= FEEDBACK_DAILY_LIMIT) return { ok: false as const, reason: 'limit' as const };
    if (isDuplicateFeedback(db, userId, f.body)) return { ok: false as const, reason: 'duplicate' as const };
    const r = db
      .prepare(`INSERT INTO feedback (user_id, email, kind, body, page, client_json) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(userId, f.email, f.kind, f.body, f.page, f.client && JSON.stringify(f.client));
    return { ok: true as const, id: Number(r.lastInsertRowid), remaining: FEEDBACK_DAILY_LIMIT - used - 1 };
  }).immediate();
}

// ── admin ────────────────────────────────────────────────────────────────────

export type Feedback = {
  id: number;
  userId: string | null;
  email: string | null;
  kind: FeedbackKind;
  body: string;
  page: string | null;
  client: ClientInfo | null;
  status: FeedbackStatus;
  note: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

type Row = {
  id: number;
  user_id: string | null;
  email: string | null;
  kind: FeedbackKind;
  body: string;
  page: string | null;
  client_json: string | null;
  status: FeedbackStatus;
  admin_note: string | null;
  created_at: string;
  resolved_at: string | null;
};

function parseClient(json: string | null): ClientInfo | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as ClientInfo;
  } catch {
    return null;
  }
}

const toFeedback = (r: Row): Feedback => ({
  id: r.id,
  userId: r.user_id,
  email: r.email,
  kind: r.kind,
  body: r.body,
  page: r.page,
  client: parseClient(r.client_json),
  status: r.status,
  note: r.admin_note,
  createdAt: r.created_at,
  resolvedAt: r.resolved_at,
});

const SELECT = 'SELECT id, user_id, email, kind, body, page, client_json, status, admin_note, created_at, resolved_at FROM feedback';

// The web never migrates: a snapshot or a process from before the table may lack it
export const hasFeedbackTable = (db: DB) => hasTable(db, 'feedback');

export function countNewFeedback(db: DB): number {
  if (!hasFeedbackTable(db)) return 0;
  return (db.prepare(`SELECT COUNT(*) AS n FROM feedback WHERE status = 'new'`).get() as { n: number }).n;
}

export type FeedbackFilter = { status?: FeedbackStatus; kind?: FeedbackKind };

export const FEEDBACK_PAGE = 50;

// New ones first (oldest of them first, the order to answer them in), then the rest newest
// first. A page of `limit` after skipping `offset` (the list's order moves as statuses change,
// so there's no stable id to page by; a skipped or repeated row across pages is harmless here).
// `more`: whether anything is past this page.
export function listFeedback(db: DB, f: FeedbackFilter = {}, limit = FEEDBACK_PAGE, offset = 0): { items: Feedback[]; more: boolean } {
  const where: string[] = [];
  const args: string[] = [];
  if (f.status) {
    where.push('status = ?');
    args.push(f.status);
  }
  if (f.kind) {
    where.push('kind = ?');
    args.push(f.kind);
  }
  const sql = `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY status = 'new' DESC, CASE WHEN status = 'new' THEN id ELSE -id END LIMIT ? OFFSET ?`;
  const rows = db.prepare(sql).all(...args, limit + 1, offset) as Row[];
  return { items: rows.slice(0, limit).map(toFeedback), more: rows.length > limit };
}

export function getFeedback(db: DB, id: number): Feedback | null {
  const r = db.prepare(`${SELECT} WHERE id = ?`).get(id) as Row | undefined;
  return r ? toFeedback(r) : null;
}

// The same account's other feedback, newest first (none once its id has been purged)
export function otherFeedback(db: DB, f: Feedback): Feedback[] {
  if (!f.userId) return [];
  return (db.prepare(`${SELECT} WHERE user_id = ? AND id != ? ORDER BY id DESC LIMIT 20`).all(f.userId, f.id) as Row[]).map(toFeedback);
}

// An admin's status and note. Leaving 'new' stamps resolved_at, going back clears it, and
// 'replied' ↔ 'closed' keeps it (when it was first answered). False when there's no such
// feedback. (SQLite evaluates every SET expression on the row as it was.)
export function updateFeedback(db: DB, id: number, change: { status?: FeedbackStatus; note?: string | null }): boolean {
  const sets: string[] = [];
  const args: (string | null)[] = [];
  if (change.status) {
    sets.push(
      'status = ?',
      `resolved_at = CASE WHEN ? = 'new' THEN NULL WHEN status = 'new' THEN strftime('%Y-%m-%dT%H:%M:%SZ', 'now') ELSE resolved_at END`,
    );
    args.push(change.status, change.status);
  }
  if (change.note !== undefined) {
    sets.push('admin_note = ?');
    args.push(change.note);
  }
  if (!sets.length) return getFeedback(db, id) !== null;
  return db.prepare(`UPDATE feedback SET ${sets.join(', ')} WHERE id = ?`).run(...args, id).changes > 0;
}

// Quoted in the reply, at most this much: Gmail's compose link carries it in the URL
const QUOTE_CHARS = 500;

// A Gmail compose window with the listener's address, a subject naming the feedback and their
// words quoted, for the admin to write the answer into and send from their own account
export function gmailReplyUrl(f: Feedback): string | null {
  if (!f.email) return null;
  const chars = [...f.body];
  const quoted = chars.length > QUOTE_CHARS ? `${chars.slice(0, QUOTE_CHARS).join('')}…` : f.body;
  const day = taipeiDate(new Date(f.createdAt));
  const body = `\n\n──────\n你在 ${day} 從股癌搜尋送出的${KIND_LABEL[f.kind]}：\n${quoted
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n')}`;
  // encodeURIComponent rather than URLSearchParams, whose + for a space isn't read back as one
  // everywhere
  const q = { view: 'cm', fs: '1', to: f.email, su: `Re: [股癌搜尋 #${f.id}] 你的${KIND_LABEL[f.kind]}`, body };
  return `https://mail.google.com/mail/?${Object.entries(q)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')}`;
}
