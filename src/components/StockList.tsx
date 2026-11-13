'use client';

import Link from 'next/link';
import { useState } from 'react';
import { searchKey, stockMatches } from '@/lib/stocks';

export type StockListItem = {
  href: string;
  name: string;
  // null when the name already is the code
  code: string | null;
  episodes: number;
  // stockSearchText: its names and codes, as the search compares them
  text: string;
  // false: too few episodes for the list, only found by searching
  listed: boolean;
};

export type StockListGroup = { label: string; stocks: StockListItem[] };

// The list on /stocks with its search box. Without a query (and without JavaScript) it shows
// the listed pages; a query looks through every page, so a company that came up once is found.
export function StockList({ groups }: { groups: StockListGroup[] }) {
  const [query, setQuery] = useState('');
  const key = searchKey(query);
  const searching = key !== '';
  const shown = groups
    .map((g) => ({ label: g.label, stocks: g.stocks.filter((s) => (searching ? stockMatches(s.text, key) : s.listed)) }))
    .filter((g) => g.stocks.length > 0);
  const found = shown.reduce((n, g) => n + g.stocks.length, 0);

  return (
    <section className="card list" id="stock-list">
      <div className="stock-search" role="search">
        <input
          className="search-input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜尋名稱或代號，例如 TSMC、006208"
          aria-label="搜尋名稱或代號"
          autoComplete="off"
          enterKeyHint="search"
        />
        {searching && (
          <p className="fine" role="status">
            {found > 0 ? `符合的有 ${found} 個` : `找不到「${query.trim()}」。節目裡可能沒提過，或摘要用了別的寫法。`}
          </p>
        )}
      </div>
      {shown.map((g) => (
        <div key={g.label}>
          <h2 className="month">
            {g.label}
            <span className="fine">　{g.stocks.length} 個</span>
          </h2>
          <div className="stock-grid">
            {/* No prefetch: a request per link would be a couple of hundred for one visit */}
            {g.stocks.map((s) => (
              <Link key={s.href} href={s.href} prefetch={false}>
                <span className="n">{s.name}</span>
                {s.code && <span className="c">{s.code}</span>}
                <span className="fine">{s.episodes} 集</span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
