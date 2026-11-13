'use client';

import { useEffect, useRef, useState } from 'react';
import { searchKey } from '@/lib/stocks';

// What an episode on the page says, as the filter compares it: its line (number, date), the
// chapters, notes and points, without the 看逐字稿 button or an opened excerpt
function shownText(ep: Element): string {
  const parts = [...ep.children].filter((c) => !c.classList.contains('excerpt-toggle')).map((c) => c.textContent ?? '');
  return searchKey(parts.join(' ')).replace(/\s+/g, ' ');
}

// 在這頁找: filters a stock page's episodes by what the page says about them (not the
// transcript, which isn't on the page). The list is rendered by the server, so this hides
// episodes in place. It also has to know the 只看深入談的 checkbox, which is plain CSS: the
// count and the months left empty depend on both.
export function EpisodeFilter() {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<number | null>(null);
  const texts = useRef<Map<Element, string> | null>(null);
  const key = searchKey(query).replace(/\s+/g, ' ');

  useEffect(() => {
    const list = document.getElementById('stock-eps');
    if (!list) return;
    const deepOnly = list.querySelector<HTMLInputElement>('#deep-only');
    const apply = () => {
      const eps = [...list.querySelectorAll<HTMLElement>('.stock-ep')];
      // Read once, on the first query
      if (key && !texts.current) texts.current = new Map(eps.map((e) => [e, shownText(e)]));
      let shown = 0;
      for (const e of eps) {
        const match = key === '' || texts.current!.get(e)!.includes(key);
        e.hidden = !match;
        if (match && (!deepOnly?.checked || e.classList.contains('deep'))) shown++;
      }
      // .empty collapses a month instead of removing it, so a chart bar can still scroll to it
      const visible = `.stock-ep:not([hidden])${deepOnly?.checked ? '.deep' : ''}`;
      for (const g of list.querySelectorAll('.month-group')) g.classList.toggle('empty', key !== '' && !g.querySelector(visible));
      list.classList.toggle('filtering', key !== '');
      setFound(key === '' ? null : shown);
    };
    apply();
    deepOnly?.addEventListener('change', apply);
    return () => deepOnly?.removeEventListener('change', apply);
  }, [key]);

  return (
    <div className="ep-filter" role="search">
      <input
        className="search-input"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="在這頁找，例如 法說"
        aria-label="在這頁的集數裡找"
        autoComplete="off"
        enterKeyHint="search"
      />
      {/* Always there, so a screen reader announces the first count too */}
      <span className="fine" role="status">
        {found === null ? '' : found > 0 ? `${found} 集` : '沒有符合的'}
      </span>
    </div>
  );
}
