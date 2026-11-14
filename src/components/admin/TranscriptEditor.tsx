'use client';

import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { AdminSegment, EditRow } from '@/lib/admin-edits';
import { formatTimestamp } from '@/lib/summary';
import { cleanSegmentText, MAX_SEGMENT_CHARS, replaceMatches } from '@/lib/transcript-edits';
import { EditChange, EditStatus, taipeiTime } from './EditStatus';

type Props = { episode: number; segments: AdminSegment[]; edits: EditRow[] };

// An unsent change to the segment at an index, with the start and text it was made on: the
// page reloads its data while edits are pending, and a draft whose segment changed since is
// shown as stale rather than sent onto another sentence
type Draft = { start: number; base: string; text: string };

// While edits are waiting for the worker, the page reloads its data this often
const REFRESH_MS = 5000;

// The admin's transcript editor: click a segment to change it, or stage a find-and-replace
// across the episode; both become drafts sent together. Segments are shown as they will read
// once the pending edits are applied, and referred to by index (two can share a start).
export function TranscriptEditor({ episode, segments, edits }: Props) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Map<number, Draft>>(() => new Map());
  const [editing, setEditing] = useState<number | null>(null);
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [skipped, setSkipped] = useState<Set<number>>(() => new Set());
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(() => edits.some((e) => e.status === 'pending'));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const pending = edits.filter((e) => e.status === 'pending').length;
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [pending, router]);

  // Unsent drafts are lost on leaving; the browser asks first
  useEffect(() => {
    if (!drafts.size) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [drafts.size]);

  const live = (i: number, d: Draft) => segments[i]?.start === d.start && segments[i]?.text === d.base;
  const stale = [...drafts].filter(([i, d]) => !live(i, d)).length;
  const current = useMemo(
    () =>
      segments.map((s, i) => {
        const d = drafts.get(i);
        return { ...s, text: d && d.start === s.start && d.base === s.text ? d.text : s.text };
      }),
    [segments, drafts],
  );
  const matches = useMemo(() => replaceMatches(current, find, replace), [current, find, replace]);
  const total = matches.reduce((n, m) => n + m.count, 0);
  const chosen = matches.filter((m) => !skipped.has(m.index));

  const setDraft = (i: number, text: string) => {
    const seg = segments[i];
    if (!seg) return;
    setDrafts((d) => {
      const next = new Map(d);
      if (text === seg.text) next.delete(i);
      else next.set(i, { start: seg.start, base: seg.text, text });
      return next;
    });
  };

  const stageReplace = () => {
    if (find === replace) return;
    for (const m of chosen) setDraft(m.index, m.newText);
    // The staged sentences no longer contain the words searched for, so the list would hide
    // them: show the changed ones instead, to be checked before sending
    setFind('');
    setReplace('');
    setSkipped(new Set());
    setOnlyChanged(true);
    setNote({ ok: true, text: `已把 ${chosen.length} 句加進待送出的修改，確認後按「送出」。` });
  };

  const submit = async () => {
    if (stale) {
      setNote({ ok: false, text: `${stale} 句修改底下的逐字稿已經變了，請取消那幾句（或全部取消）再改。` });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const body = {
        episode,
        edits: [...drafts].map(([index, d]) => ({ index, start: d.start, oldText: d.base, newText: d.text })),
      };
      const res = await fetch('/api/admin/edits', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { count?: number; error?: string };
      if (!res.ok) {
        setNote({ ok: false, text: data.error ?? `送出失敗（${res.status}）` });
        return;
      }
      setDrafts(new Map());
      setHistoryOpen(true);
      setNote({ ok: true, text: `已送出 ${data.count} 句，worker 約 15 秒內套用並重新建立索引。` });
      router.refresh();
    } catch {
      setNote({ ok: false, text: '送出失敗，請檢查連線再試一次。' });
    } finally {
      setBusy(false);
    }
  };

  const shown = current
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => {
      if (onlyChanged && !drafts.has(i) && !s.pending) return false;
      return !find || s.text.includes(find);
    });

  return (
    <div className="admin-editor">
      <section className="card admin-replace" aria-label="整集取代">
        <h2>整集取代</h2>
        <div className="admin-replace-fields">
          <input
            value={find}
            onChange={(e) => {
              setFind(e.target.value);
              setSkipped(new Set());
            }}
            placeholder="錯字，例如 交言肥腸"
            aria-label="錯字"
          />
          <span aria-hidden="true">→</span>
          <input value={replace} onChange={(e) => setReplace(e.target.value)} placeholder="改成，例如 椒鹽肥腸" aria-label="改成" />
        </div>
        {find && (
          <>
            <p className="muted">
              {total ? `${matches.length} 句、${total} 處符合；下面的逐字稿只列出這些句子，取消勾選可以略過。` : '這集沒有符合的文字。'}
            </p>
            {matches.length > 0 && (
              <ul className="admin-matches">
                {matches.map((m) => (
                  <li key={m.index}>
                    <label>
                      <input
                        type="checkbox"
                        checked={!skipped.has(m.index)}
                        onChange={(e) =>
                          setSkipped((s) => {
                            const next = new Set(s);
                            if (e.target.checked) next.delete(m.index);
                            else next.add(m.index);
                            return next;
                          })
                        }
                      />
                      <span className="admin-ts">{formatTimestamp(m.start)}</span>
                      <Highlight text={m.oldText} term={find} />
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <button className="btn primary" disabled={!chosen.length || find === replace} onClick={stageReplace}>
              加進修改（{chosen.length} 句）
            </button>
          </>
        )}
      </section>

      {edits.length > 0 && (
        <details className="card admin-history" open={historyOpen} onToggle={(e) => setHistoryOpen(e.currentTarget.open)}>
          <summary>
            修改紀錄（{edits.length}）{pending > 0 && <span className="pill info">{pending} 句待套用</span>}
          </summary>
          <ul className="admin-log">
            {edits.map((e) => {
              const i = segments.findIndex((s) => s.start === e.segStart && s.text === e.newText);
              // Undoing stages the old text as a draft, to be checked and sent like any edit
              const canUndo = e.status === 'applied' && i >= 0 && !drafts.has(i);
              return (
                <li key={e.id}>
                  <EditStatus edit={e} />
                  <a href={`#t-${Math.floor(e.segStart)}`}>{formatTimestamp(e.segStart)}</a>
                  <EditChange edit={e} />
                  <span className="muted">{taipeiTime(e.createdAt)}</span>
                  {e.error && <span className="muted">{e.error}</span>}
                  {canUndo && (
                    <button className="btn ghost" onClick={() => setDraft(i, e.oldText)}>
                      還原
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      )}

      <div className="admin-filter">
        <label>
          <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} /> 只看有修改的句子
        </label>
        <span className="muted">
          {shown.length} / {segments.length} 句
        </span>
      </div>

      <ol className="admin-segments">
        {shown.map(({ s, i }) => {
          const draft = drafts.get(i);
          const isStale = draft !== undefined && !live(i, draft);
          return (
            <li key={i} id={`t-${Math.floor(s.start)}`} className={draft ? 'draft' : s.pending ? 'pending' : undefined}>
              <a className="admin-ts" href={`/ep/${episode}?t=${Math.floor(s.start)}`} target="_blank" rel="noopener">
                {formatTimestamp(s.start)}
              </a>
              {editing === i ? (
                <SegmentInput
                  initial={s.text}
                  onDone={(text) => {
                    const clean = text === null ? null : cleanSegmentText(text);
                    if (clean === '') setNote({ ok: false, text: '句子不能是空的，沒有改。' });
                    else if (clean !== null) setDraft(i, clean);
                    setEditing(null);
                  }}
                />
              ) : (
                <button className="admin-seg" onClick={() => setEditing(i)}>
                  <Highlight text={s.text} term={find} />
                </button>
              )}
              <span className="admin-flags">
                {s.pending && !draft && <span className="pill info">待套用</span>}
                {draft && (
                  <>
                    <span className="pill warn">{isStale ? '逐字稿已變' : '未送出'}</span>
                    <button
                      className="btn ghost"
                      onClick={() =>
                        setDrafts((d) => {
                          const next = new Map(d);
                          next.delete(i);
                          return next;
                        })
                      }
                    >
                      取消
                    </button>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ol>

      {(drafts.size > 0 || note) && (
        <div className="admin-bar" role="status">
          {note && <span className={note.ok ? 'muted' : 'admin-error'}>{note.text}</span>}
          {drafts.size > 0 && (
            <>
              <span>{drafts.size} 句修改未送出</span>
              <button className="btn ghost" disabled={busy} onClick={() => setDrafts(new Map())}>
                全部取消
              </button>
              <button className="btn primary" disabled={busy} onClick={submit}>
                {busy ? '送出中…' : '送出'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Enter keeps the text, Escape drops it; null: cancelled
function SegmentInput({ initial, onDone }: { initial: string; onDone: (text: string | null) => void }) {
  const [text, setText] = useState(initial);
  // Once only: the blur that follows Escape or Enter must not count again
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(value);
  };
  return (
    <textarea
      className="admin-input"
      autoFocus
      value={text}
      maxLength={MAX_SEGMENT_CHARS}
      rows={Math.min(6, Math.ceil([...text].length / 36) + 1)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(text)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') finish(null);
        // Not while an input method is composing: Enter there picks the characters
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          finish(text);
        }
      }}
    />
  );
}

function Highlight({ text, term }: { text: string; term: string }) {
  if (!term || !text.includes(term)) return <>{text}</>;
  const parts = text.split(term);
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <mark>{term}</mark>}
          {p}
        </Fragment>
      ))}
    </>
  );
}
