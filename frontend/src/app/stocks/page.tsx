'use client';

import { useEffect, useState } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hook';
import { fetchStocksList, StockSummary } from '@/features/stocksSlice';
import Link from 'next/link';

type SortKey = 'count' | 'lastDate';

function formatDate(d: string) {
  if (!d) return '';
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

export default function StocksPage() {
  const dispatch = useAppDispatch();
  const { list, listStatus } = useAppSelector((s) => s.stocks);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('count');

  useEffect(() => {
    if (listStatus === 'idle' || listStatus === 'failed') {
      dispatch(fetchStocksList());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  const filtered: StockSummary[] = list
    .filter((s) => s.ticker.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) =>
      sort === 'count'
        ? b.count - a.count
        : (b.lastDate ?? '').localeCompare(a.lastDate ?? '')
    );

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 pb-24 sm:pb-8">
      <h1 className="text-xl font-bold text-gray-800 mb-4">股票提及追蹤器</h1>

      {/* Controls */}
      <div className="flex gap-3 mb-5 flex-wrap">
        <input
          type="text"
          placeholder="搜尋代號（如 NVDA、2330）"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <div className="flex gap-2">
          {(['count', 'lastDate'] as SortKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              className={`text-xs px-3 py-1 rounded-full border transition ${
                sort === k
                  ? 'bg-blue-500 text-white border-blue-500'
                  : 'text-gray-600 border-gray-300 hover:border-blue-400'
              }`}
            >
              {k === 'count' ? '按提及次數' : '按最近提及'}
            </button>
          ))}
        </div>
      </div>

      {/* States */}
      {listStatus === 'loading' && (
        <p className="text-center text-gray-400 animate-pulse mt-16">載入中...</p>
      )}
      {listStatus === 'failed' && (
        <div className="flex flex-col items-center gap-3 mt-16">
          <p className="text-red-500 text-sm">載入失敗，請確認後端服務正在運行。</p>
          <button
            onClick={() => dispatch(fetchStocksList())}
            className="px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
          >
            重試
          </button>
        </div>
      )}
      {listStatus === 'succeeded' && filtered.length === 0 && (
        <p className="text-center text-gray-400 text-sm mt-16">
          {query ? `找不到「${query}」` : '尚無股票資料，請先執行 reindex。'}
        </p>
      )}
      {listStatus === 'succeeded' && filtered.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {filtered.map((s) => (
            <Link
              key={s.ticker}
              href={`/stocks/${s.ticker}`}
              className="bg-white border border-gray-200 rounded-lg px-4 py-3 hover:border-blue-300 hover:shadow-sm transition"
            >
              <p className="text-base font-bold text-gray-800">{s.ticker}</p>
              <p className="text-xs text-gray-500 mt-1">
                提及 <span className="font-semibold text-blue-600">{s.count}</span> 集
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                最近 {formatDate(s.lastDate)}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
