'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { LoginButton } from '@/components/UserMenu';
import { charCount, MAX_NOTE_CHARS, MAX_REPORT_CHARS, type ReportTarget } from '@/lib/report-limits';

// What a listener selected: in the transcript (a paragraph, by its start) or the summary
type Picked = { target: ReportTarget; at: number | null; original: string };

// Query parameters that carry a selection through the Google login and back
const P_WORDS = 'report';
const P_TARGET = 'rt';
const P_AT = 'at';

// The words selected inside one report area ([data-report]): in the transcript, inside one
// paragraph's text ([data-at] > p); in the summary, inside one line of text. Null otherwise.
function pickSelection(): Picked | { tooLong: true } | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const text = sel.toString().trim();
  if (!text || /[\r\n]/.test(text)) return null;
  const el = (n: Node | null) => (n instanceof Element ? n : (n?.parentElement ?? null));
  const a = el(sel.anchorNode);
  const f = el(sel.focusNode);
  const area = a?.closest<HTMLElement>('[data-report]');
  if (!area || area !== f?.closest('[data-report]')) return null;
  const target = area.dataset.report as ReportTarget;
  let at: number | null = null;
  if (target === 'transcript') {
    const para = a!.closest<HTMLElement>('[data-at]');
    const p = a!.closest('p');
    if (!para || !p || para !== f!.closest('[data-at]') || p !== f!.closest('p')) return null;
    at = Number(para.dataset.at);
  }
  if (charCount(text) > MAX_REPORT_CHARS) return { tooLong: true };
  return { target, at, original: text };
}

// Lets a listener report a typo: select words in the transcript or summary, press 回報錯字, say
// what they should be. Signed out, the same button explains that reporting needs a login and
// carries the selection through it. Nothing changes on the site until an admin accepts.
// After the selection goes away the button stays this long: on a phone, the tap on the button
// itself clears the selection before the button hears it
const LINGER_MS = 400;

// Memoized: EpisodeView re-renders about 4 times a second during playback, and the open form
// must not re-render (or refocus) with it
export const TypoReporter = memo(function TypoReporter({ episode, signedIn }: { episode: number; signedIn: boolean }) {
  const [fab, setFab] = useState<{ x: number; y: number; picked: Picked | null } | null>(null);
  const [open, setOpen] = useState<Picked | null>(null);
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null);

  const place = useCallback(() => {
    const picked = pickSelection();
    const sel = window.getSelection();
    if (!picked || !sel?.rangeCount) {
      hide.current ??= setTimeout(() => {
        hide.current = null;
        setFab(null);
      }, LINGER_MS);
      return;
    }
    if (hide.current) clearTimeout(hide.current);
    hide.current = null;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const x = Math.min(Math.max(8, rect.left), window.innerWidth - 150);
    // Below the selection: phones put their own menu above it
    const y = Math.min(rect.bottom + 10, window.innerHeight - 56);
    setFab({ x, y, picked: 'tooLong' in picked ? null : picked });
  }, []);

  useEffect(() => {
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    // Scrolling moves the selection, so the button follows it
    document.addEventListener('selectionchange', later);
    window.addEventListener('scroll', later, { passive: true });
    window.addEventListener('resize', later);
    return () => {
      cancelAnimationFrame(frame);
      if (hide.current) clearTimeout(hide.current);
      document.removeEventListener('selectionchange', later);
      window.removeEventListener('scroll', later);
      window.removeEventListener('resize', later);
    };
  }, [place]);

  const start = useCallback((picked: Picked | null) => {
    if (!picked) return;
    if (hide.current) clearTimeout(hide.current);
    hide.current = null;
    setOpen(picked);
    setFab(null);
  }, []);
  const close = useCallback(() => setOpen(null), []);

  // Back from the login with a selection: open the form with it, and take it out of the URL
  useEffect(() => {
    const url = new URL(window.location.href);
    const words = url.searchParams.get(P_WORDS);
    if (words === null) return;
    const target = url.searchParams.get(P_TARGET) === 'summary' ? 'summary' : 'transcript';
    const at = url.searchParams.get(P_AT);
    for (const p of [P_WORDS, P_TARGET, P_AT]) url.searchParams.delete(p);
    window.history.replaceState(null, '', url);
    if (words && charCount(words) <= MAX_REPORT_CHARS) setOpen({ target, at: at === null ? null : Number(at), original: words });
  }, []);

  return (
    <>
      {fab && !open && (
        <button
          className="btn primary report-fab"
          style={{ left: fab.x, top: fab.y }}
          disabled={!fab.picked}
          // Opens on the press, before a phone clears the selection, and keeps a mouse from
          // clearing it; the click is for the keyboard
          onPointerDown={(e) => {
            e.preventDefault();
            start(fab.picked);
          }}
          onClick={() => start(fab.picked)}
        >
          {fab.picked ? '回報錯字' : `最多選 ${MAX_REPORT_CHARS} 字`}
        </button>
      )}
      {open && <ReportDialog episode={episode} signedIn={signedIn} picked={open} onClose={close} />}
    </>
  );
});

function ReportDialog({ episode, signedIn, picked, onClose }: { episode: number; signedIn: boolean; picked: Picked; onClose: () => void }) {
  const [original, setOriginal] = useState(picked.original);
  const [suggestion, setSuggestion] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const first = useRef<HTMLInputElement>(null);

  // Once, when the form opens
  useEffect(() => first.current?.focus(), []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  // Where the login comes back to: this episode, the same tab, the selection in the URL
  const back = () => {
    const q = new URLSearchParams();
    if (picked.target === 'transcript') q.set('tab', 'tx');
    q.set(P_WORDS, picked.original);
    q.set(P_TARGET, picked.target);
    if (picked.at !== null) q.set(P_AT, String(picked.at));
    return `/ep/${episode}?${q}`;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ episode, target: picked.target, at: picked.at, original, suggestion, note: note || null }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setResult(res.ok ? { ok: true, text: '收到了，謝謝！確認後會更新到網站上。' } : { ok: false, text: data.error ?? `送出失敗（${res.status}）` });
    } catch {
      setResult({ ok: false, text: '送出失敗，請檢查連線再試一次。' });
    } finally {
      setBusy(false);
    }
  };

  const where = picked.target === 'transcript' ? '逐字稿' : '重點';
  return (
    <div className="report-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card report-dialog" role="dialog" aria-modal="true" aria-labelledby="report-title">
        <h2 id="report-title">回報{where}錯字</h2>
        {!signedIn ? (
          <>
            <p>
              登入後就能回報錯字。登入只用來防止濫用，不會公開你的名字；登入完會回到這裡，你選的「{picked.original}」也會保留。
            </p>
            <div className="report-actions">
              <button type="button" className="btn ghost" onClick={onClose}>
                取消
              </button>
              <LoginButton callbackUrl={back()} />
            </div>
          </>
        ) : result?.ok ? (
          <>
            <p>{result.text}</p>
            <div className="report-actions">
              <button type="button" className="btn primary" onClick={onClose}>
                關閉
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <label className="report-field">
              <span>原文</span>
              <input value={original} onChange={(e) => setOriginal(e.target.value)} maxLength={MAX_REPORT_CHARS * 2} required />
            </label>
            <label className="report-field">
              <span>應該是</span>
              <input
                ref={first}
                value={suggestion}
                onChange={(e) => setSuggestion(e.target.value)}
                maxLength={MAX_REPORT_CHARS * 2}
                placeholder="正確的寫法"
                required
              />
            </label>
            <label className="report-field">
              <span>備註（選填）</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={MAX_NOTE_CHARS} placeholder="例如：這裡講的是公司名稱" />
            </label>
            {result && <p className="report-error">{result.text}</p>}
            <p className="muted report-small">管理員確認後才會更新到網站上。</p>
            <div className="report-actions">
              <button type="button" className="btn ghost" onClick={onClose}>
                取消
              </button>
              <button className="btn primary" disabled={busy || !suggestion.trim()}>
                {busy ? '送出中…' : '送出'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
