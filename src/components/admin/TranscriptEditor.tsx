'use client';

import { useRouter } from 'next/navigation';
import { Fragment, memo, type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AdminSegment, EditRow } from '@/lib/admin-edits';
import type { SeekTable } from '@/lib/seek';
import { formatTimestamp } from '@/lib/summary';
import { cleanSegmentText, MAX_SEGMENT_CHARS, replaceMatches } from '@/lib/transcript-edits';
import { AdminPlayer, type PlayerHandle } from './AdminPlayer';
import { EditChange, EditStatus, taipeiTime } from './EditStatus';

type Props = {
  episode: number;
  audioUrl: string;
  duration: number;
  seek: SeekTable | null;
  segments: AdminSegment[];
  edits: EditRow[];
};

// An unsent change to the segment at an index, with the start and text it was made on: the
// page reloads its data while edits are pending, and a draft whose segment changed since is
// shown as stale rather than sent onto another sentence
type Draft = { start: number; base: string; text: string };

// While edits are waiting for the worker, the page reloads its data this often
const REFRESH_MS = 5000;
// ← / → move this far
const STEP_SECONDS = 5;
// Following playback scrolls once the segment playing goes below this share of what the
// header, the player and the send bar leave visible (or above it), not on every segment
const FOLLOW_BAND = 0.8;

// The admin's transcript editor: click a segment to change it, or stage a find-and-replace
// across the episode; both become drafts sent together. Segments are shown as they will read
// once the pending edits are applied, and referred to by index (two can share a start).
// The player marks the segment playing and the list follows it, to correct while listening.
export function TranscriptEditor({ episode, audioUrl, duration, seek, segments, edits }: Props) {
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
  const player = useRef<PlayerHandle>(null);
  const [nowIndex, setNowIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [follow, setFollow] = useState(true);
  // Scrolled away by hand while following: following waits for 回到播放處 (or a timestamp)
  const [detached, setDetached] = useState(false);

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

  const setDraft = useCallback(
    (i: number, text: string) => {
      const seg = segments[i];
      if (!seg) return;
      setDrafts((d) => {
        const next = new Map(d);
        if (text === seg.text) next.delete(i);
        else next.set(i, { start: seg.start, base: seg.text, text });
        return next;
      });
    },
    [segments],
  );

  // Stable, so a row re-renders only when what it shows changes (playback moves the mark a few
  // times a minute; an episode has up to about 800 segments)
  const onEdit = useCallback((i: number) => setEditing(i), []);
  const onDone = useCallback(
    (i: number, text: string | null) => {
      const clean = text === null ? null : cleanSegmentText(text);
      if (clean === '') setNote({ ok: false, text: '句子不能是空的，沒有改。' });
      else if (clean !== null) setDraft(i, clean);
      setEditing(null);
    },
    [setDraft],
  );
  const onDrop = useCallback(
    (i: number) =>
      setDrafts((d) => {
        const next = new Map(d);
        next.delete(i);
        return next;
      }),
    [],
  );
  const onPlay = useCallback((t: number) => {
    setDetached(false);
    player.current?.seek(t, true);
  }, []);

  // Following playback: only while playing, not while a segment is being edited (the text box
  // would move away mid-word) and not after scrolling by hand
  const editingNow = useRef(editing);
  editingNow.current = editing;
  useEffect(() => {
    if (!playing || !follow || detached || editingNow.current !== null || nowIndex < 0) return;
    const el = document.querySelector(`.admin-segments [data-seg="${nowIndex}"]`);
    if (el && !inBand(el)) scrollToRow(el);
  }, [nowIndex, playing, follow, detached]);

  // Wheel and touch scrolling come only from the user (scrollIntoView sends neither), as do a
  // press on the page's scrollbar and a middle-button autoscroll; the keys that scroll are caught
  // below. Not on the player (its slider is dragged by touch), in the match list, which scrolls
  // by itself, or in the text box, nor a pinch or ctrl-wheel zoom.
  useEffect(() => {
    if (!playing || !follow) return;
    const away = (e: Event) => {
      if (e instanceof WheelEvent && e.ctrlKey) return;
      if (e.target instanceof Element && e.target.closest('.admin-player, .admin-matches, textarea')) return;
      setDetached(true);
    };
    const press = (e: globalThis.MouseEvent) => {
      if (e.button === 1 || e.clientX >= document.documentElement.clientWidth) setDetached(true);
    };
    window.addEventListener('wheel', away, { passive: true });
    window.addEventListener('touchmove', away, { passive: true });
    window.addEventListener('mousedown', press);
    return () => {
      window.removeEventListener('wheel', away);
      window.removeEventListener('touchmove', away);
      window.removeEventListener('mousedown', press);
    };
  }, [playing, follow]);
  const reattach = useCallback(() => setDetached(false), []);

  // Shortcuts, outside text fields: Space plays or pauses, ← / → move STEP_SECONDS, Enter pauses
  // and edits the segment playing
  const keys = useRef({ nowIndex, playing, follow });
  keys.current = { nowIndex, playing, follow };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return;
      const k = keys.current;
      switch (e.key) {
        case ' ':
          // A focused button or summary takes Space itself
          if (e.repeat || el?.closest('button, summary')) return;
          e.preventDefault();
          player.current?.toggle();
          return;
        case 'ArrowLeft':
        case 'ArrowRight':
          e.preventDefault();
          // Held down it would repeat about 30 times a second, each seek a new audio request
          if (e.repeat) return;
          player.current?.skip(e.key === 'ArrowLeft' ? -STEP_SECONDS : STEP_SECONDS);
          return;
        case 'Enter': {
          if (el?.closest('button, a, summary') || k.nowIndex < 0) return;
          if (!document.querySelector(`.admin-segments [data-seg="${k.nowIndex}"]`)) return;
          e.preventDefault();
          player.current?.pause();
          setEditing(k.nowIndex);
          return;
        }
        case 'ArrowUp':
        case 'ArrowDown':
        case 'PageUp':
        case 'PageDown':
        case 'Home':
        case 'End':
          if (k.playing && k.follow) setDetached(true);
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
      <AdminPlayer
        ref={player}
        audioUrl={audioUrl}
        duration={duration}
        table={seek}
        segments={segments}
        onSegment={setNowIndex}
        onPlaying={setPlaying}
        onBarSeek={reattach}
      >
        {follow && detached && nowIndex >= 0 && (
          <button
            className="btn ghost"
            onClick={() => {
              setDetached(false);
              const el = document.querySelector(`.admin-segments [data-seg="${nowIndex}"]`);
              if (el) scrollToRow(el);
            }}
          >
            回到播放處
          </button>
        )}
      </AdminPlayer>
      <p className="muted admin-keys">
        點時間戳從那句播放（⌘／Ctrl 點擊開公開頁面）。空白鍵播放／暫停，← → 倒退／快轉 {STEP_SECONDS} 秒，Enter 暫停並改正在播的那句。
      </p>

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
                  {/* Goes to the segment and moves the player there, playing or not as it was */}
                  <a
                    href={`#t-${Math.floor(e.segStart)}`}
                    onClick={() => {
                      setDetached(false);
                      player.current?.seek(e.segStart);
                    }}
                  >
                    {formatTimestamp(e.segStart)}
                  </a>
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
        <span className="admin-filter-opts">
          <label>
            <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} /> 只看有修改的句子
          </label>
          <label>
            <input
              type="checkbox"
              checked={follow}
              onChange={(e) => {
                setFollow(e.target.checked);
                setDetached(false);
              }}
            />{' '}
            跟著播放捲動
          </label>
        </span>
        <span className="muted">
          {shown.length} / {segments.length} 句
        </span>
      </div>

      <ol className="admin-segments">
        {shown.map(({ s, i }) => {
          const draft = drafts.get(i);
          return (
            <SegmentRow
              key={i}
              episode={episode}
              index={i}
              seg={s}
              draft={draft}
              stale={draft !== undefined && !live(i, draft)}
              editing={editing === i}
              now={nowIndex === i}
              find={find}
              onEdit={onEdit}
              onDone={onDone}
              onDrop={onDrop}
              onPlay={onPlay}
            />
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

// Whether el sits in the upper FOLLOW_BAND of what the header, the player, the send bar and the
// bottom nav leave visible (the player is under the header on wide screens and at the bottom on
// narrow ones)
function inBand(el: Element): boolean {
  let top = document.querySelector('header.top')?.getBoundingClientRect().bottom ?? 0;
  let bottom = window.innerHeight;
  for (const sel of ['.admin-player', '.admin-bar', 'nav.bottom']) {
    const r = document.querySelector(sel)?.getBoundingClientRect();
    if (!r || !r.height) continue;
    if (r.top < window.innerHeight / 2) top = Math.max(top, r.bottom);
    else bottom = Math.min(bottom, r.top);
  }
  const r = el.getBoundingClientRect();
  return r.top >= top && r.bottom <= top + (bottom - top) * FOLLOW_BAND;
}

function scrollToRow(el: Element) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
}

const SegmentRow = memo(function SegmentRow(props: {
  episode: number;
  index: number;
  seg: AdminSegment;
  draft: Draft | undefined;
  stale: boolean;
  editing: boolean;
  now: boolean;
  find: string;
  onEdit: (i: number) => void;
  onDone: (i: number, text: string | null) => void;
  onDrop: (i: number) => void;
  onPlay: (t: number) => void;
}) {
  const { episode, index: i, seg: s, draft, stale, editing, now, find } = props;
  const cls = [draft ? 'draft' : s.pending ? 'pending' : '', now ? 'now' : ''].filter(Boolean).join(' ');
  // A plain click plays from here; with a modifier (or the middle button) the link opens the
  // public page there as before
  const play = (e: MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    // Left focused, the link would open the public page on the next Enter, which edits instead
    if (e.currentTarget instanceof HTMLElement) e.currentTarget.blur();
    props.onPlay(s.start);
  };
  return (
    <li id={`t-${Math.floor(s.start)}`} data-seg={i} className={cls || undefined} aria-current={now || undefined}>
      <a
        className="admin-ts"
        href={`/ep/${episode}?t=${Math.floor(s.start)}`}
        target="_blank"
        rel="noopener"
        onClick={play}
        title="從這句播放（⌘／Ctrl 點擊開公開頁面）"
      >
        {formatTimestamp(s.start)}
      </a>
      {editing ? (
        <SegmentInput initial={s.text} onDone={(text) => props.onDone(i, text)} onReplay={() => props.onPlay(s.start)} />
      ) : (
        <button className="admin-seg" onClick={() => props.onEdit(i)}>
          <Highlight text={s.text} term={find} />
        </button>
      )}
      <span className="admin-flags">
        {s.pending && !draft && <span className="pill info">待套用</span>}
        {draft && (
          <>
            <span className="pill warn">{stale ? '逐字稿已變' : '未送出'}</span>
            <button className="btn ghost" onClick={() => props.onDrop(i)}>
              取消
            </button>
          </>
        )}
      </span>
    </li>
  );
});

// Enter keeps the text, Escape drops it; null: cancelled
function SegmentInput({ initial, onDone, onReplay }: { initial: string; onDone: (text: string | null) => void; onReplay: () => void }) {
  const [text, setText] = useState(initial);
  // Once only: the blur that follows Escape or Enter must not count again
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(value);
  };
  return (
    <div className="admin-input-wrap">
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
      {/* Keeps the focus in the text box, whose blur would end the edit */}
      <button className="btn ghost" onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={onReplay}>
        ▶ 重播這句
      </button>
    </div>
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
