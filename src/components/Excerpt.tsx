'use client';

import Link from 'next/link';
import { useState } from 'react';
import { formatTimestamp } from '@/lib/summary';

type Excerpt = { t: number; text: string };

// The transcript around a timestamp. data-nosnippet: it is raw speech-to-text, which search
// results shouldn't quote (same as the transcript on an episode's page).
export function ExcerptText({ episodeNo, excerpt }: { episodeNo: number; excerpt: Excerpt }) {
  return (
    <blockquote className="excerpt" data-nosnippet>
      <p>{excerpt.text}</p>
      <footer className="fine">
        逐字稿由 AI 轉錄，可能有錯字。
        <Link href={`/ep/${episodeNo}?t=${excerpt.t}`}>從 {formatTimestamp(excerpt.t)} 開始聽 →</Link>
      </footer>
    </blockquote>
  );
}

// 看逐字稿: fetched on the first click, so a page with a hundred episodes doesn't carry a
// hundred excerpts
export function ExcerptToggle({ episodeNo, t }: { episodeNo: number; t: number }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<Excerpt | 'loading' | 'error' | 'none' | null>(null);

  async function toggle() {
    setOpen(!open);
    if (open || (state !== null && state !== 'error')) return;
    setState('loading');
    try {
      const res = await fetch(`/api/excerpt?ep=${episodeNo}&t=${t}`);
      // 404: the episode has no transcript (or is gone); asking again won't change that
      setState(res.ok ? ((await res.json()) as Excerpt) : res.status === 404 ? 'none' : 'error');
    } catch {
      setState('error');
    }
  }

  return (
    <div className="excerpt-toggle">
      <button className="btn ghost" onClick={toggle} aria-expanded={open}>
        {open ? '收起逐字稿' : '看逐字稿'}
      </button>
      {open && state === 'loading' && <p className="fine" role="status">讀取中…</p>}
      {open && state === 'error' && <p className="fine" role="status">讀不到這一段逐字稿，請再試一次。</p>}
      {open && state === 'none' && <p className="fine" role="status">這一段沒有逐字稿。</p>}
      {open && state !== null && typeof state === 'object' && <ExcerptText episodeNo={episodeNo} excerpt={state} />}
    </div>
  );
}
