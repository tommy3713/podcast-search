// What a listener thinks of an answer on /ask: 😀 or 🙁 under it, and with 🙁 why (some
// reasons and a note, both optional). Shared by the page (in the browser), the route, the
// admin pages and the worker's Telegram texts. No imports, so the page's bundle stays small.

export const RATINGS = ['good', 'bad'] as const;
export type Rating = (typeof RATINGS)[number];

export const RATING_ICON: Record<Rating, string> = { good: '😀', bad: '🙁' };
export const RATING_LABEL: Record<Rating, string> = { good: '很讚', bad: '不滿意' };

// In the order the page shows them; the log keeps the keys in this order too
export const RATING_REASONS = ['wrong_episode', 'off_topic', 'unsupported', 'incomplete', 'other'] as const;
export type RatingReason = (typeof RATING_REASONS)[number];

export const REASON_LABEL: Record<RatingReason, string> = {
  wrong_episode: '找錯集數',
  off_topic: '答非所問',
  unsupported: '跟出處說的不一樣',
  incomplete: '漏了重要的內容',
  other: '其他',
};

// Code points
export const MAX_RATING_NOTE_CHARS = 200;

// The reasons as the log keeps them (a JSON array of keys), read back leniently: anything
// that isn't a known key is left out
export function parseReasons(json: string | null): RatingReason[] {
  try {
    const v: unknown = json ? JSON.parse(json) : [];
    return Array.isArray(v) ? RATING_REASONS.filter((r) => v.includes(r)) : [];
  } catch {
    return [];
  }
}

// As the admin pages and Telegram list them
export const reasonText = (reasons: readonly RatingReason[]) => reasons.map((r) => REASON_LABEL[r]).join('、');

export const isRating =(v: unknown): v is Rating => v === 'good' || v === 'bad';
