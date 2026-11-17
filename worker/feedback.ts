import { type DB, hasTable } from '@/lib/db.ts';
import { FEEDBACK_KEEP_DAYS } from '@/lib/feedback-limits.ts';

// /about promises a listener's email and account id are kept FEEDBACK_KEEP_DAYS with their
// feedback; the words stay. Returns how many rows it took them from (nightly VACUUMs when it's
// more than none, like the question purge, so they don't stay readable in free pages).
export function purgeFeedbackContacts(db: DB): number {
  if (!hasTable(db, 'feedback')) return 0;
  return db
    .prepare(
      `UPDATE feedback SET user_id = NULL, email = NULL
       WHERE (user_id IS NOT NULL OR email IS NOT NULL) AND created_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?)`,
    )
    .run(`-${FEEDBACK_KEEP_DAYS} days`).changes;
}
