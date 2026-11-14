'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

type Props = { current: string; initial: string; add: string | null; limit: number };

// The prompt's text with its token count, worked out on the server as the admin types
// (Whisper's vocabulary is too big to send to the browser). `initial`: the text to start
// from (the current version, or an older one to restore).
export function WhisperEditor({ current, initial, add, limit }: Props) {
  const router = useRouter();
  const [text, setText] = useState(initial);
  const [tokens, setTokens] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setTokens(null);
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/admin/whisper', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'count', text }),
          signal: ctl.signal,
        });
        if (res.ok) setTokens(((await res.json()) as { tokens: number }).tokens);
      } catch {}
    }, 300);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [text]);

  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch('/api/admin/whisper', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'save', text }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setNote({ ok: false, text: data.error ?? `失敗（${res.status}）` });
        return;
      }
      // The page shows the new version as current (and drops ?restore= / ?add=)
      router.replace('/admin/whisper');
      router.refresh();
    } catch {
      setNote({ ok: false, text: '連線失敗，請再試一次。' });
    } finally {
      setBusy(false);
    }
  };

  const over = tokens !== null && tokens > limit;
  const same = text.replace(/\s+/g, ' ').trim() === current;
  return (
    <section className="card admin-whisper">
      {add && (
        <p className="admin-whisper-add">
          要加入的詞：<strong>{add}</strong>（自己決定放在句子的哪裡，讓它讀起來像在講話）
        </p>
      )}
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} aria-label="Whisper 提示詞" />
      <div className="admin-report-actions">
        <span className={over ? 'admin-error' : 'muted'}>
          {tokens === null ? '計算中…' : `${tokens} / ${limit} token`}
          {over && '，超過上限'}
        </span>
        <span style={{ flex: 1 }} />
        {text !== current && (
          <button className="btn ghost" disabled={busy} onClick={() => setText(current)}>
            改回使用中的版本
          </button>
        )}
        <button className="btn primary" disabled={busy || same || !text.trim() || over || tokens === null} onClick={save}>
          {busy ? '儲存中…' : '存成新版本'}
        </button>
      </div>
      {note && <p className={note.ok ? 'muted' : 'admin-error'}>{note.text}</p>}
    </section>
  );
}
