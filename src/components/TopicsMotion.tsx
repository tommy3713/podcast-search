'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// A number that counts up from 0 the first time it comes into view (after the library's 數據儀表
// 卡片). The server renders the real number, so it is there without JavaScript and for
// search engines; with reduced motion it never moves.
export function CountUp({ value, ms = 900 }: { value: number; ms?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced() || value < 2) return;
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const tick = (now: number) => {
        const k = Math.min(1, (now - start) / ms);
        // Ease out: fast at first, settling on the number
        setShown(Math.round(value * (1 - (1 - k) ** 3)));
        if (k < 1) raf = requestAnimationFrame(tick);
      };
      setShown(0);
      raf = requestAnimationFrame(tick);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value, ms]);
  return (
    <span ref={ref} className="count-up">
      {shown}
    </span>
  );
}

// The cards' borders light up around the pointer, across the whole grid (after the library's
// 邊框聚光網格): one listener writes each card's pointer position into CSS variables.
export function SpotlightGrid({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced() || !window.matchMedia('(hover: hover)').matches) return;
    const cards = [...el.querySelectorAll<HTMLElement>('.tcard')];
    let raf = 0;
    let at: [number, number] = [0, 0];
    // Once a frame: every rect read first, then every write, so the layout is worked out once
    const paint = () => {
      raf = 0;
      const rects = cards.map((c) => c.getBoundingClientRect());
      cards.forEach((c, i) => {
        c.style.setProperty('--mx', `${at[0] - rects[i]!.left}px`);
        c.style.setProperty('--my', `${at[1] - rects[i]!.top}px`);
      });
      el.style.setProperty('--spot', '1');
    };
    const move = (e: PointerEvent) => {
      at = [e.clientX, e.clientY];
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const leave = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      el.style.setProperty('--spot', '0');
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
    };
  }, []);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
