'use client';

import { useEffect, useState } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hook';
import { fetchGlossary, GlossaryTerm } from '@/features/glossarySlice';
import Link from 'next/link';

function formatDate(uploadDate: string): string {
  if (!uploadDate || uploadDate.length < 8) return uploadDate;
  return `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}`;
}

function TermCard({ term }: { term: GlossaryTerm }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden hover:border-blue-300 transition">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-4 py-3 flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-bold text-gray-800 text-sm truncate">
            {term.term}
          </span>
          <span className="shrink-0 text-xs font-medium bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
            {term.count} 集
          </span>
        </div>
        <span className="shrink-0 text-gray-400 text-xs">
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-3">
          {term.occurrences.map((occ) => (
            <div key={occ.fullTitle} className="space-y-1">
              {occ.quote && (
                <p className="text-xs text-gray-500 italic leading-relaxed">
                  「{occ.quote}」
                </p>
              )}
              <Link
                href={`/summary/Gooaye/${occ.episode}`}
                className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
              >
                EP{occ.episode} {occ.title}
                <span className="text-gray-400 ml-1">
                  {formatDate(occ.uploadDate)}
                </span>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function GlossaryPage() {
  const dispatch = useAppDispatch();
  const { terms, status } = useAppSelector((s) => s.glossary);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (
      status === 'idle' ||
      status === 'failed' ||
      (status === 'succeeded' && terms.length === 0)
    ) {
      dispatch(fetchGlossary());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  const filtered = terms.filter((t) =>
    t.term.toLowerCase().includes(search.toLowerCase())
  );

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-400 animate-pulse">載入中...</p>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-red-500">載入失敗，請確認後端服務正在運行。</p>
        <button
          onClick={() => dispatch(fetchGlossary())}
          className="px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
        >
          重試
        </button>
      </div>
    );
  }

  if (status === 'succeeded' && terms.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-400 text-sm">目前沒有術語資料</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 pb-24 sm:pb-8">
      <h1 className="text-xl font-bold text-gray-800 mb-1">投資概念字典</h1>
      <p className="text-sm text-gray-500 mb-5">
        股癌常用的投資術語與框架，點擊展開查看出處引用與集數連結。
      </p>

      {/* Search input */}
      <div className="mb-5">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
          }}
          placeholder="搜尋術語..."
          className="w-full sm:w-80 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-gray-400 text-sm text-center mt-8">沒有符合的術語</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((term) => (
            <TermCard key={term.term} term={term} />
          ))}
        </div>
      )}
    </div>
  );
}
