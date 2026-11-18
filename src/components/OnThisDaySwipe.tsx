'use client';

import { type ReactNode, useEffect, useRef } from 'react';

// 那年今日's card. Phones (640 px and below) lay the years' panels side by side in a
// scroll-snap track (globals.css) and swipe through them; this keeps the year tabs (radios
// named `name`, inside `tabs`) and the panel in view together: picking a year scrolls to its
// panel, and a swipe checks the year it comes to rest on. Panels off screen are inert, so focus
// and screen readers stay on the year shown. Wider screens show one panel by the checked radio
// alone (CSS); the track doesn't scroll there, so this only clears `inert`.
export function OnThisDaySwipe({ name, tabs, children }: { name: string; tabs: ReactNode; children: ReactNode }) {
  const card = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = card.current;
    const t = track.current;
    if (!el || !t) return;
    const radios = [...el.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)];
    const panels = [...t.children] as HTMLElement[];
    const swipes = () => t.scrollWidth > t.clientWidth + 1;
    const at = () => Math.round(t.scrollLeft / Math.max(1, t.clientWidth));
    const mark = (i: number) => panels.forEach((p, k) => (p.inert = swipes() && k !== i));

    // Where the track rests: its year checked, the other panels inert
    const settled = () => {
      if (!swipes()) return mark(-1);
      const i = at();
      const radio = radios[i];
      if (radio && !radio.checked) radio.checked = true;
      mark(i);
    };
    // The checked year's panel brought into view, as a tab does; on load, a resize, or a radio
    // a reload left checked
    const align = (smooth: boolean) => {
      if (!swipes()) return mark(-1);
      const i = Math.max(0, radios.findIndex((r) => r.checked));
      mark(i);
      if (at() === i) return;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      t.scrollTo({ left: i * t.clientWidth, behavior: smooth && !reduced ? 'smooth' : 'auto' });
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
    const resize = () => align(false);
    const hasScrollEnd = 'onscrollend' in window;
    el.addEventListener('change', onPick);
    window.addEventListener('resize', resize);
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
