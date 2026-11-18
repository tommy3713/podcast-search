'use client';

import { type ReactNode, useEffect, useRef } from 'react';

// 歷史上的今天's card. Phones (640 px and below) lay the years' panels side by side in a
// scroll-snap track (globals.css) and swipe through them; this keeps the year tabs (radios
// named `name`, inside `tabs`) and the panel in view together: picking a year scrolls to its
// panel, and a swipe checks the year it comes to rest on. Panels off screen are inert, so focus
// and screen readers stay on the year shown. Wider screens show one panel by the checked radio
// alone (CSS); the track doesn't scroll there, so this only clears `inert`. On any screen, once
// the years don't fit the tab row scrolls sideways, and the checked one is kept in view there.
export function OnThisDaySwipe({ name, tabs, children }: { name: string; tabs: ReactNode; children: ReactNode }) {
  const card = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = card.current;
    const t = track.current;
    if (!el || !t) return;
    const radios = [...el.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)];
    const panels = [...t.children] as HTMLElement[];
    const bar = el.querySelector<HTMLElement>('.otd-tabbar');
    const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const swipes = () => t.scrollWidth > t.clientWidth + 1;
    // Year i's tab centred in the tab row when the row scrolls and the tab isn't wholly in view
    // (so a swipe to a year already showing leaves the row alone); the row only, never the page
    const showTab = (i: number, smooth: boolean) => {
      const tab = radios[i]?.closest('label');
      if (!bar || !tab || bar.scrollWidth <= bar.clientWidth + 1) return;
      const b = bar.getBoundingClientRect();
      const r = tab.getBoundingClientRect();
      if (r.left >= b.left - 1 && r.right <= b.right + 1) return;
      const left = r.left - b.left + bar.scrollLeft - (bar.clientWidth - tab.offsetWidth) / 2;
      bar.scrollTo({ left, behavior: smooth && !reduced() ? 'smooth' : 'auto' });
    };
    // Which ends of the tab row have years scrolled out of view (globals.css fades those edges):
    // the tab cut off at the edge can be only a sliver when the card is near a multiple of a tab
    const edges = () => {
      if (!bar) return;
      const more = bar.scrollWidth > bar.clientWidth + 1;
      bar.dataset.before = String(more && bar.scrollLeft > 1);
      bar.dataset.after = String(more && bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 1);
    };
    const at = () => Math.round(t.scrollLeft / Math.max(1, t.clientWidth));
    const mark = (i: number) => panels.forEach((p, k) => (p.inert = swipes() && k !== i));

    // Where the track rests: its year checked, the other panels inert
    const settled = () => {
      if (!swipes()) return mark(-1);
      const i = at();
      const radio = radios[i];
      if (radio && !radio.checked) radio.checked = true;
      mark(i);
      showTab(i, true);
    };
    // The checked year's panel brought into view, as a tab does; on load, a resize, or a radio
    // a reload left checked. Its tab too, except on a resize: a phone's address bar showing or
    // hiding is one, and the row may be where the listener scrolled it
    const align = (smooth: boolean, tab = true) => {
      const i = Math.max(0, radios.findIndex((r) => r.checked));
      if (tab) showTab(i, smooth);
      edges();
      if (!swipes()) return mark(-1);
      mark(i);
      if (at() === i) return;
      t.scrollTo({ left: i * t.clientWidth, behavior: smooth && !reduced() ? 'smooth' : 'auto' });
    };
    align(false);

    const onPick = (e: Event) => {
      if (radios.includes(e.target as HTMLInputElement)) align(true);
    };
    // scrollend where there is one (not Safari before 26); else a pause in the scrolling once
    // the finger is up, so a drag held mid-way doesn't pick a year
    let touching = false;
    let pause = 0;
    const later = () => {
      clearTimeout(pause);
      if (!touching) pause = window.setTimeout(settled, 150);
    };
    const down = () => {
      touching = true;
      clearTimeout(pause);
    };
    const up = () => {
      touching = false;
      later();
    };
    const resize = () => align(false, false);
    const hasScrollEnd = 'onscrollend' in window;
    el.addEventListener('change', onPick);
    window.addEventListener('resize', resize);
    bar?.addEventListener('scroll', edges, { passive: true });
    if (hasScrollEnd) t.addEventListener('scrollend', settled);
    else {
      t.addEventListener('scroll', later, { passive: true });
      t.addEventListener('touchstart', down, { passive: true });
      t.addEventListener('touchend', up, { passive: true });
      t.addEventListener('touchcancel', up, { passive: true });
    }
    return () => {
      clearTimeout(pause);
      el.removeEventListener('change', onPick);
      window.removeEventListener('resize', resize);
      bar?.removeEventListener('scroll', edges);
      t.removeEventListener('scrollend', settled);
      t.removeEventListener('scroll', later);
      t.removeEventListener('touchstart', down);
      t.removeEventListener('touchend', up);
      t.removeEventListener('touchcancel', up);
    };
  }, [name]);
  return (
    <div ref={card} className="card otd-tabs">
      {tabs}
      <div ref={track} className="otd-panels">
        {children}
      </div>
    </div>
  );
}
