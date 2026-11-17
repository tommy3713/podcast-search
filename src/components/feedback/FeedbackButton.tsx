'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LoginButton } from '@/components/UserMenu';
import {
  charCount,
  FEEDBACK_KINDS,
  FEEDBACK_PARAM,
  type FeedbackKind,
  isEmail,
  KIND_ICON,
  KIND_LABEL,
  MAX_EMAIL_CHARS,
  MAX_FEEDBACK_CHARS,
} from '@/lib/feedback-limits';

const PLACEHOLDER: Record<FeedbackKind, string> = {
  bug: '哪一頁、做了什麼、看到什麼？例如：在 EP709 點時間戳，播放的位置不對',
  idea: '想要什麼功能？用起來會是什麼樣子？',
  other: '想說的話',
};

const isKind = (s: string | null): s is FeedbackKind => FEEDBACK_KINDS.includes(s as FeedbackKind);

function clientInfo() {
  const set = document.documentElement.dataset.theme;
  const theme = set === 'light' || set === 'dark' ? set : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return { ua: navigator.userAgent, width: window.innerWidth, height: window.innerHeight, theme };
}

// The header's feedback button, beside the theme toggle: a bug, a wish or anything else, with an
// email only if the listener wants to hear back. Signed out, the dialog asks for the login and
// comes back with ?feedback=<kind>, which reopens it and is taken out of the URL.
export function FeedbackButton({ signedIn }: { signedIn: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<FeedbackKind>('bug');
  // The form's key: bumped on the first opening and after a sent one, so a draft closed by
  // Esc, 取消 or the backdrop is still there when the dialog opens again
  const [round, setRound] = useState(0);
  const sent = useRef(false);
  // Whether the press that ends in a click started on the backdrop: a drag that selects text in
  // the textarea and is let go outside the card also clicks the <dialog> itself
  const pressedBackdrop = useRef(false);

  const open = useCallback((k?: FeedbackKind) => {
    if (k) setKind(k);
    const fresh = sent.current;
    sent.current = false;
    setRound((r) => (r === 0 || fresh ? r + 1 : r));
    dialog.current?.showModal();
  }, []);
  const close = useCallback(() => dialog.current?.close(), []);
  const onSent = useCallback(() => {
    sent.current = true;
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const k = url.searchParams.get(FEEDBACK_PARAM);
    if (k === null) return;
    url.searchParams.delete(FEEDBACK_PARAM);
    window.history.replaceState(window.history.state, '', url);
    open(isKind(k) ? k : undefined);
  }, [open]);

  return (
    <>
      <button type="button" className="btn ghost icon-btn" onClick={() => open()} aria-haspopup="dialog">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12Z" />
          <path d="M8.5 12h.01M12 12h.01M15.5 12h.01" />
        </svg>
        <span className="sr-only">意見回饋</span>
      </button>
      <dialog
        ref={dialog}
        className="feedback-dialog"
        aria-labelledby="feedback-title"
        // The dialog itself has no padding, so only the backdrop is the dialog itself
        onPointerDown={(e) => {
          pressedBackdrop.current = e.target === e.currentTarget;
        }}
        onClick={(e) => e.target === e.currentTarget && pressedBackdrop.current && close()}
      >
        <div className="card report-dialog">
          {round > 0 && <FeedbackForm key={round} signedIn={signedIn} kind={kind} setKind={setKind} onClose={close} onSent={onSent} />}
        </div>
      </dialog>
    </>
  );
}

function FeedbackForm({
  signedIn,
  kind,
  setKind,
  onClose,
  onSent,
}: {
  signedIn: boolean;
  kind: FeedbackKind;
  setKind: (k: FeedbackKind) => void;
  onClose: () => void;
  onSent: () => void;
}) {
  const pathname = usePathname();
  const [body, setBody] = useState('');
  const [email, setEmail] = useState('');
  const [withClient, setWithClient] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ id: number; email: boolean } | null>(null);

  // Where the login comes back to: this page, with the form open again
  const back = () => {
    const url = new URL(window.location.href);
    url.searchParams.set(FEEDBACK_PARAM, kind);
    return url.pathname + url.search + url.hash;
  };

  const emailBad = email.trim() !== '' && !isEmail(email.trim());
  const tooLong = charCount(body) > MAX_FEEDBACK_CHARS;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind,
          body,
          email: email.trim() || null,
          page: pathname,
          client: kind === 'bug' && withClient ? clientInfo() : null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; id?: number };
      if (res.ok && data.id) {
        setSent({ id: data.id, email: email.trim() !== '' });
        onSent();
      }
      else setError(data.error ?? `送出失敗（${res.status}）`);
    } catch {
      setError('送出失敗，請檢查連線再試一次。');
    } finally {
      setBusy(false);
    }
  };

  if (!signedIn) {
    return (
      <>
        <h2 id="feedback-title">意見回饋</h2>
        <p>遇到問題、想要新功能，或有話想說，都歡迎告訴我們。登入只用來防止濫用，不會公開你的名字；登入完會回到這一頁。</p>
        <div className="report-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            取消
          </button>
          <LoginButton callbackUrl={back()} />
        </div>
      </>
    );
  }

  if (sent) {
    return (
      <>
        <h2 id="feedback-title">收到了，謝謝！</h2>
        <p>
          編號 #{sent.id}。
          {sent.email ? '有需要的話會寫信到你留的 email。' : '你沒有留 email，所以不會收到回覆；之後想補充可以再送一則。'}
        </p>
        <div className="report-actions">
          <button type="button" className="btn primary" onClick={onClose} autoFocus>
            關閉
          </button>
        </div>
      </>
    );
  }

  return (
    <form onSubmit={submit}>
      <h2 id="feedback-title">意見回饋</h2>
      <div className="feedback-kinds" role="radiogroup" aria-label="類型">
        {FEEDBACK_KINDS.map((k) => (
          <label key={k} className={k === kind ? 'on' : undefined}>
            <input type="radio" name="feedback-kind" value={k} checked={k === kind} onChange={() => setKind(k)} />
            <span aria-hidden="true">{KIND_ICON[k]}</span> {KIND_LABEL[k]}
          </label>
        ))}
      </div>
      <label className="report-field">
        <span>內容</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} placeholder={PLACEHOLDER[kind]} required autoFocus />
        {tooLong && <small className="report-error">最多 {MAX_FEEDBACK_CHARS} 字（現在 {charCount(body)} 字）</small>}
      </label>
      <label className="report-field">
        <span>Email（選填）</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={MAX_EMAIL_CHARS}
          autoComplete="email"
          placeholder="想收到回覆的話再填"
        />
        {emailBad && <small className="report-error">Email 格式不對</small>}
      </label>
      {kind === 'bug' && (
        <label className="feedback-check">
          <input type="checkbox" checked={withClient} onChange={(e) => setWithClient(e.target.checked)} />
          <span>附上瀏覽器資訊（瀏覽器版本、視窗大小、深淺色模式），方便找出問題</span>
        </label>
      )}
      <p className="muted report-small">
        從 <span className="mono">{pathname}</span> 送出。內容只有站長看得到，不會公開。
      </p>
      {error && <p className="report-error">{error}</p>}
      <div className="report-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          取消
        </button>
        <button className="btn primary" disabled={busy || !body.trim() || tooLong || emailBad}>
          {busy ? '送出中…' : '送出'}
        </button>
      </div>
    </form>
  );
}
