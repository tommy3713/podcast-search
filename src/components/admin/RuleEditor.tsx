'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { RuleEpisode } from '@/lib/rules';
import { formatTimestamp } from '@/lib/summary';

// ruleId: the rule being edited (its words can change too), or null for a new one
type Props = { ruleId: number | null; initialOriginal: string; initialReplacement: string; initialNote: string; initialEnabled: boolean };

const post = (body: unknown) =>
  fetch('/api/admin/rules', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

// Adds or edits a rule. As soon as both words are in, every live episode it would change is
// listed (each with a checkbox, all checked), so applying it to existing episodes is a
// decision made on what it would do.
export function RuleEditor({ ruleId, initialOriginal, initialReplacement, initialNote, initialEnabled }: Props) {
  const router = useRouter();
  const [original, setOriginal] = useState(initialOriginal);
  const [replacement, setReplacement] = useState(initialReplacement);
  const [note, setNote] = useState(initialNote);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [summary, setSummary] = useState(true);
  // With the words it was worked out for: applying sends those episodes only for those words
  const [preview, setPreview] = useState<{ key: string; episodes: RuleEpisode[]; usd: number } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<Set<number>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const o = original.trim();
  const r = replacement.trim();
  const key = `${o}\u0000${r}`;
  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    setSkipped(new Set());
    if (!o || !r || o === r) return;
    // A request for words since changed is cancelled, so its answer can't land as this one's
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/admin/rules', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'preview', original: o, replacement: r }),
          signal: ctl.signal,
        });
        const data = (await res.json().catch(() => ({}))) as { episodes?: RuleEpisode[]; usdPerEpisode?: number; error?: string };
        if (!res.ok) setPreviewError(data.error ?? `預覽失敗（${res.status}）`);
        else setPreview({ key: `${o}\u0000${r}`, episodes: data.episodes ?? [], usd: data.usdPerEpisode ?? 0 });
      } catch {
        if (!ctl.signal.aborted) setPreviewError('預覽失敗，請檢查連線。');
      }
    }, 500);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [o, r]);

  const current = preview?.key === key ? preview : null;
  const chosen = current?.episodes.filter((e) => !skipped.has(e.no)) ?? [];
  const total = chosen.reduce((n, e) => n + e.count, 0);
  const summaryTotal = chosen.reduce((n, e) => n + e.summaryCount, 0);

  const save = async (apply: boolean) => {
    setBusy(true);
    setResult(null);
    try {
      const res = await post({
        action: 'save',
        ...(ruleId === null ? {} : { id: ruleId }),
        original: o,
        replacement: r,
        note: note.trim() || null,
        enabled,
        episodes: apply ? chosen.map((e) => e.no) : [],
        summary,
      });
      const data = (await res.json().catch(() => ({}))) as {
        applied?: { episodes: number; segments: number; summary: number };
        error?: string;
      };
      if (!res.ok) {
        setResult({ ok: false, text: data.error ?? `儲存失敗（${res.status}）` });
        return;
      }
      const a = data.applied;
      setResult({
        ok: true,
        text:
          a && a.episodes
            ? `已儲存規則，並排入 ${a.episodes} 集的修改（逐字稿 ${a.segments} 句${a.summary ? `、重點 ${a.summary} 處` : ''}），worker 會一集一集套用。`
            : '已儲存規則，之後轉錄的集數會套用。',
      });
      router.refresh();
    } catch {
      setResult({ ok: false, text: '連線失敗，請再試一次。' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (ruleId === null) return;
    setBusy(true);
    try {
      const res = await post({ action: 'delete', id: ruleId });
      if (res.ok) {
        router.replace('/admin/rules');
        router.refresh();
      } else setResult({ ok: false, text: `刪除失敗（${res.status}）` });
    } finally {
      setBusy(false);
    }
  };

  const short = o && [...o].length < 3;
  return (
    <section className="card admin-rule-editor" aria-label="新增或編輯規則">
      <h2>{ruleId === null ? '新增規則' : `編輯規則（第 ${ruleId} 條）`}</h2>
      <div className="admin-replace-fields">
        <input value={original} onChange={(e) => setOriginal(e.target.value)} placeholder="錯字，例如 交言肥腸" aria-label="錯字" />
        <span aria-hidden="true">→</span>
        <input value={replacement} onChange={(e) => setReplacement(e.target.value)} placeholder="改成，例如 椒鹽肥腸" aria-label="改成" />
      </div>
      <input className="admin-rule-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="備註（選填），例如：主持人的名字" aria-label="備註" />
      <label>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> 啟用（之後轉錄的集數套用）
      </label>
      {short && <p className="admin-error">只有 {[...o].length} 個字的錯字很容易出現在別的詞裡，請仔細看下面的預覽。</p>}
      {previewError && <p className="admin-error">{previewError}</p>}

      {current && (
        <>
          <p className="muted">
            {current.episodes.length
              ? `現有 ${current.episodes.length} 集會被改到；取消勾選可以略過那一集。`
              : '現有的集數都沒有這個錯字，存起來只影響之後轉錄的集數。'}
          </p>
          {current.episodes.length > 0 && (
            <ul className="admin-rule-preview">
              {current.episodes.map((e) => (
                <li key={e.no}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!skipped.has(e.no)}
                      onChange={(ev) =>
                        setSkipped((s) => {
                          const next = new Set(s);
                          if (ev.target.checked) next.delete(e.no);
                          else next.add(e.no);
                          return next;
                        })
                      }
                    />
                    <Link href={`/admin/ep/${e.no}`} target="_blank">
                      EP{e.no}
                    </Link>
                    <span className="muted">
                      逐字稿 {e.count} 處{e.summaryCount ? `・重點 ${e.summaryCount} 處` : ''}
                    </span>
                  </label>
                  {e.samples.map((s, i) => (
                    <p key={i} className="admin-rule-sample">
                      <span className="admin-ts">{formatTimestamp(s.start)}</span> <Mark text={s.text} term={o} />
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="admin-report-actions">
        <label>
          <input type="checkbox" checked={summary} onChange={(e) => setSummary(e.target.checked)} /> 重點也改
        </label>
        <span style={{ flex: 1 }} />
        {ruleId !== null && (
          // Edits it already queued stay; they're ordinary edits now
          <button className="btn ghost" disabled={busy} onClick={remove}>
            刪除規則
          </button>
        )}
        <button className="btn" disabled={busy || !o || !r || o === r} onClick={() => save(false)}>
          只存規則
        </button>
        <button className="btn primary" disabled={busy || !current || !chosen.length} onClick={() => save(true)}>
          存規則並套用到 {chosen.length} 集（約 US${(chosen.length * (current?.usd ?? 0)).toFixed(3)}）
        </button>
      </div>
      {current && chosen.length > 0 && (
        <p className="muted admin-small">
          會改逐字稿 {total} 處{summary && summaryTotal ? `、重點 ${summaryTotal} 處` : ''}。
        </p>
      )}
      {result && <p className={result.ok ? 'muted' : 'admin-error'}>{result.text}</p>}
    </section>
  );
}

export function RuleToggle({ id, enabled }: { id: number; enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <label className="admin-rule-toggle">
      <input
        type="checkbox"
        checked={enabled}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          try {
            await post({ action: 'enable', id, enabled: e.target.checked });
            router.refresh();
          } finally {
            setBusy(false);
          }
        }}
      />
      {enabled ? '啟用' : '停用'}
    </label>
  );
}

function Mark({ text, term }: { text: string; term: string }) {
  const parts = text.split(term);
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <mark>{term}</mark>}
          {p}
        </span>
      ))}
    </>
  );
}
