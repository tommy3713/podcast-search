'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FEEDBACK_STATUSES, type FeedbackStatus, STATUS_LABEL } from '@/lib/feedback-limits';

// An admin's status buttons and private note for one feedback (POST /api/admin/feedback)
export function FeedbackActions({ id, status, note }: { id: number; status: FeedbackStatus; note: string | null }) {
  const router = useRouter();
  const [draft, setDraft] = useState(note ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async (change: { status?: FeedbackStatus; note?: string }, done: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, ...change }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setMessage(res.ok ? { ok: true, text: done } : { ok: false, text: data.error ?? `失敗（${res.status}）` });
      if (res.ok) router.refresh();
    } catch {
      setMessage({ ok: false, text: '失敗，請檢查連線再試一次。' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-feedback-actions">
      <div className="admin-report-actions">
        <span className="muted">狀態</span>
        {FEEDBACK_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            className={s === status ? 'btn primary' : 'btn ghost'}
            aria-pressed={s === status}
            disabled={busy}
            onClick={() => s !== status && save({ status: s }, `已改成「${STATUS_LABEL[s]}」`)}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      <label className="report-field">
        <span>私人備註（只有管理員看得到）</span>
        <textarea className="admin-rule-note" value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} maxLength={2000} />
      </label>
      <div className="admin-report-actions">
        <button type="button" className="btn ghost" disabled={busy || draft.trim() === (note ?? '')} onClick={() => save({ note: draft }, '備註已存')}>
          存備註
        </button>
        {message && <span className={message.ok ? 'muted' : 'report-error'}>{message.text}</span>}
      </div>
    </div>
  );
}
