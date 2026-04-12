'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useAppDispatch, useAppSelector } from '@/app/hook';
import { fetchStockDetail } from '@/features/stocksSlice';
import Link from 'next/link';

const SENTIMENT_LABEL: Record<string, string> = {
  bullish: '看多',
  bearish: '看空',
  neutral: '中性',
};

const SENTIMENT_COLOR: Record<string, string> = {
  bullish: 'bg-green-100 text-green-700',
  bearish: 'bg-red-100 text-red-700',
  neutral: 'bg-gray-100 text-gray-600',
};

function formatDate(d: string) {
  if (!d || d.length < 8) return d ?? '';
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

function SentimentBar({ counts }: { counts: { bullish: number; bearish: number; neutral: number } }) {
  const total = counts.bullish + counts.bearish + counts.neutral;
  if (total === 0) return null;
  const pct = (n: number) => Math.round((n / total) * 100);
  return (
    <div>
      <div className="flex h-3 rounded-full overflow-hidden gap-px">
        {counts.bullish > 0 && (
          <div className="bg-green-500" style={{ width: `${pct(counts.bullish)}%` }} />
        )}
        {counts.neutral > 0 && (
          <div className="bg-gray-300" style={{ width: `${pct(counts.neutral)}%` }} />
        )}
        {counts.bearish > 0 && (
          <div className="bg-red-400" style={{ width: `${pct(counts.bearish)}%` }} />
        )}
      </div>
      <div className="flex gap-4 mt-1.5 text-xs text-gray-500">
        <span className="text-green-600">看多 {counts.bullish}（{pct(counts.bullish)}%）</span>
        <span className="text-gray-500">中性 {counts.neutral}</span>
        <span className="text-red-500">看空 {counts.bearish}（{pct(counts.bearish)}%）</span>
      </div>
    </div>
  );
}

export default function StockDetailPage() {
  const { ticker } = useParams<{ ticker: string }>();
  const dispatch = useAppDispatch();
  const { detail, detailStatus } = useAppSelector((s) => s.stocks);

  useEffect(() => {
    if (ticker) dispatch(fetchStockDetail(decodeURIComponent(ticker)));
  }, [dispatch, ticker]);

  if (detailStatus === 'loading') {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-400 animate-pulse">載入中...</p>
      </div>
    );
  }

  if (detailStatus === 'failed') {
    return (
      <div className="flex flex-col items-center gap-3 h-64 justify-center">
        <p className="text-red-500 text-sm">載入失敗</p>
        <button
          onClick={() => dispatch(fetchStockDetail(decodeURIComponent(ticker)))}
          className="px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
        >
          重試
        </button>
      </div>
    );
  }

  if (!detail) return null;

  const dates = detail.episodes.map((e) => e.uploadDate).filter(Boolean);
  const firstDate = dates.length ? formatDate([...dates].sort()[0]) : '—';
  const lastDate = dates.length ? formatDate([...dates].sort().reverse()[0]) : '—';

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-24 sm:pb-8">
      {/* Header */}
      <div className="mb-1">
        <Link href="/stocks" className="text-xs text-blue-500 hover:underline">
          ← 所有股票
        </Link>
      </div>
      <h1 className="text-2xl font-bold text-gray-800 mt-2">{detail.ticker}</h1>

      {/* Stats row */}
      <div className="flex gap-6 mt-3 mb-5 flex-wrap text-sm text-gray-600">
        <div>
          <span className="text-gray-400 text-xs">提及集數</span>
          <p className="text-xl font-bold text-blue-600">{detail.episodes.length}</p>
        </div>
        <div>
          <span className="text-gray-400 text-xs">首次提及</span>
          <p className="font-medium">{firstDate}</p>
        </div>
        <div>
          <span className="text-gray-400 text-xs">最近提及</span>
          <p className="font-medium">{lastDate}</p>
        </div>
      </div>

      {/* Sentiment bar */}
      <div className="mb-6">
        <p className="text-xs text-gray-500 mb-2">情緒分佈</p>
        <SentimentBar counts={detail.sentimentCounts} />
      </div>

      {/* Episode list */}
      <h2 className="text-sm font-semibold text-gray-700 mb-3">相關集數</h2>
      <div className="space-y-2">
        {detail.episodes.map((ep) => (
          <Link
            key={ep.fullTitle}
            href={`/summary/Gooaye/${ep.episode}`}
            className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-3 hover:border-blue-300 hover:shadow-sm transition"
          >
            <div className="min-w-0 mr-3">
              <p className="text-sm font-medium text-gray-800 truncate">
                EP{ep.episode} {ep.title}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">{formatDate(ep.uploadDate)}</p>
            </div>
            <span
              className={`text-xs px-2 py-0.5 rounded-full shrink-0 font-medium ${SENTIMENT_COLOR[ep.sentiment]}`}
            >
              {SENTIMENT_LABEL[ep.sentiment]}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
