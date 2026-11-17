// What feedback may hold, shared by the header's form (in the browser) and src/lib/feedback.ts
// (on the server). No imports beyond report-limits (none of its own), so the bundle stays small.

export { charCount } from './report-limits.ts';

export const FEEDBACK_KINDS = ['bug', 'idea', 'other'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const KIND_LABEL: Record<FeedbackKind, string> = { bug: '問題回報', idea: '功能許願', other: '其他意見' };
export const KIND_ICON: Record<FeedbackKind, string> = { bug: '🐞', idea: '💡', other: '💬' };

// An admin's mark: 'replied' once answered by mail, 'closed' when nothing more will happen
export const FEEDBACK_STATUSES = ['new', 'replied', 'closed'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export const STATUS_LABEL: Record<FeedbackStatus, string> = { new: '新的', replied: '已回覆', closed: '結案' };
export const STATUS_PILL: Record<FeedbackStatus, string> = { new: 'pill warn', replied: 'pill info', closed: 'pill flat' };

export const FEEDBACK_DAILY_LIMIT = 3;
// Code points
export const MAX_FEEDBACK_CHARS = 2000;
export const MAX_EMAIL_CHARS = 254;
// The email and account id are kept this long (nightly sets them NULL), as /about says
export const FEEDBACK_KEEP_DAYS = 180;

// Loose on purpose: it only has to catch a typo, and the admin reads it before writing
export const isEmail = (s: string) => s.length <= MAX_EMAIL_CHARS && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

// A path on this site: one slash, never // or /\ (a link to another host), and no whitespace or
// control characters, which URL parsing drops (so /<tab>/evil.example would become //evil.example).
// A percent-encoded topic path runs long, hence the room.
export const isSitePath = (s: string) => s.length <= 2000 && /^\/(?![/\\])[^\s\x00-\x1f\x7f]*$/.test(s);

// The query parameter that reopens the form after the Google login (its value: the kind)
export const FEEDBACK_PARAM = 'feedback';
