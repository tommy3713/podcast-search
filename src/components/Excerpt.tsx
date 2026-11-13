'use client';

import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { PlayTs } from '@/components/StockPlayer';
import type { PlayPoint } from '@/lib/seek';
import { formatTimestamp } from '@/lib/summary';

type Excerpt = { t: number; text: string; point: PlayPoint | null };

// The transcript around a timestamp. data-nosnippet: it is raw speech-to-text, which search
// results shouldn't quote (same as the transcript on an episode's page).
export function ExcerptText({ episodeNo, excerpt }: { episodeNo: number; excerpt: Excerpt }) {
  return (
    <blockquote className="excerpt" data-nosnippet>
      <p>{excerpt.text}</p>
      <footer className="fine">
        逐字稿由 AI 轉錄，可能有錯字。
        <PlayTs className="" episodeNo={episodeNo} t={excerpt.t} point={excerpt.point}>
          從 {formatTimestamp(excerpt.t)} 開始聽 →
        </PlayTs>
      </footer>
    </blockquote>
  );
}

type Loaded = Excerpt | 'error' | 'none';

let transitionId = 0;

// The bars that stay on screen: named while a transition runs, so they are drawn over the cards
// moving under them, as they are outside one. Only those shown, so a name is never used twice.
const BARS = 'header.top, nav.bottom, .mini-player';

// Opens or closes with a view transition when the toggle is in an item marked data-vt-item (the
// quote wall's cards, where an open card takes the whole row): the card grows into its row and
// the cards after it slide to their new places instead of jumping. Only items within about a
// screen of the viewport are named; the rest change out of sight. Done at once under reduced
// motion and where view transition classes aren't supported (Safari before 18.2 has
// startViewTransition without them, and would stretch the cards' text).
function transition(from: HTMLElement | null, update: () => void) {
  if (
    !from?.closest('[data-vt-item]') ||
    !('startViewTransition' in document) ||
    !CSS.supports('view-transition-class', 'a') ||
    reducedMotion()
  ) {
    update();
    return Promise.resolve();
  }
  const id = ++transitionId;
  const items = [...document.querySelectorAll<HTMLElement>(`[data-vt-item], ${BARS}`)];
  const unname = () =>
    items.forEach((el) => {
      el.style.removeProperty('view-transition-name');
      el.style.removeProperty('view-transition-class');
    });
  // A transition still running when the next one starts: start from no names, or two could clash
  unname();
  const h = window.innerHeight;
  let n = 0;
  for (const el of items) {
    if (!el.matches('[data-vt-item]')) {
      if (el.getClientRects().length > 0) el.style.setProperty('view-transition-name', `vt-bar-${n++}`);
      continue;
    }
    const r = el.getBoundingClientRect();
    if (r.bottom < -h || r.top > 2 * h) continue;
    el.style.setProperty('view-transition-name', `vt-item-${n++}`);
    el.style.setProperty('view-transition-class', 'vt-item');
  }
  // flushSync: the after picture is taken once the callback returns, so React must have
  // committed by then
  return document
    .startViewTransition(() => flushSync(update))
    .finished.catch(() => {})
    .finally(() => {
      if (id === transitionId) unname();
    });
}

function reducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// 看逐字稿: fetched on the first click, so a page with a hundred episodes doesn't carry a
// hundred excerpts. It opens once the text is in, so it grows once rather than twice.
export function ExcerptToggle({ episodeNo, t }: { episodeNo: number; t: number }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Set from opening until its fade ends, so the fade doesn't run again when a filter hides and
  // shows an open excerpt
  const [opening, setOpening] = useState(false);
  const [state, setState] = useState<Loaded | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  async function load(): Promise<Loaded> {
    try {
      const res = await fetch(`/api/excerpt?ep=${episodeNo}&t=${t}`);
      // 404: the episode has no transcript (or is gone); asking again won't change that
      return res.ok ? ((await res.json()) as Excerpt) : res.status === 404 ? 'none' : 'error';
    } catch {
      return 'error';
    }
  }

  async function toggle() {
    if (busy) return;
    if (open) {
      await transition(button.current, () => setOpen(false));
    } else {
      let next = state;
      if (next === null || next === 'error') {
        setBusy(true);
        next = await load();
      }
      const loaded = next;
      await transition(button.current, () => {
        setBusy(false);
        setState(loaded);
        setOpen(true);
        setOpening(true);
      });
    }
    // An open card on a quote wall moves to a row of its own, which can take it out of view:
    // bring in what was opened (or the button, once closed). Nothing scrolls if it's in view.
    (open ? button : box).current?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  return (
    <div ref={box} className="excerpt-toggle" data-opening={opening || undefined} onAnimationEnd={() => setOpening(false)}>
      <button ref={button} className="btn ghost" onClick={toggle} aria-expanded={open} aria-busy={busy}>
        {busy ? '讀取中…' : open ? '收起逐字稿' : '看逐字稿'}
      </button>
      <span className="sr-only" role="status">
        {busy ? '讀取中…' : ''}
      </span>
      {open && state === 'error' && <p className="fine" role="status">讀不到這一段逐字稿，請再試一次。</p>}
      {open && state === 'none' && <p className="fine" role="status">這一段沒有逐字稿。</p>}
      {open && state !== null && typeof state === 'object' && <ExcerptText episodeNo={episodeNo} excerpt={state} />}
    </div>
  );
}
