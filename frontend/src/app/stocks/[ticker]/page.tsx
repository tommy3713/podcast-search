'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useAppDispatch, useAppSelector } from '@/app/hook';
import { fetchStockDetail } from '@/features/stocksSlice';
import { fetchAnalysisList } from '@/features/analysisSlice';
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

interface DriftEntry {
  episode: string;
  title: string;
  uploadDate: string;
  sentiment: string;
  reason: string;
}

interface DriftData {
  timeline: DriftEntry[];
  driftAnalysis: string;
}

export default function StockDetailPage() {
  const { ticker } = useParams<{ ticker: string }>();
  const dispatch = useAppDispatch();
  const { detail, detailStatus } = useAppSelector((s) => s.stocks);
  const analysisList = useAppSelector((s) => s.analysis.list);

  const [driftData, setDriftData] = useState<DriftData | null>(null);
  const [driftStatus, setDriftStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  useEffect(() => {
    if (ticker) dispatch(fetchStockDetail(decodeURIComponent(ticker)));
  }, [dispatch, ticker]);

  useEffect(() => {
    dispatch(fetchAnalysisList());
  }, [dispatch]);

  const handleFetchDrift = async () => {
    if (!ticker) return;
    setDriftStatus('loading');
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? '';
      const res = await fetch(`${backendUrl}/api/stocks/${encodeURIComponent(decodeURIComponent(ticker))}/drift`);
      if (!res.ok) throw new Error('fetch failed');
      const data: DriftData = await res.json();
      setDriftData(data);
      setDriftStatus('done');
    } catch {
      setDriftStatus('error');
    }
  };

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

  const analysis = analysisList.find((a) => a.key === detail.ticker.toUpperCase());

  const driftTimelineRows = driftData?.timeline.filter((e) => e.reason !== '') ?? [];
  const hasEnoughData = driftTimelineRows.length >= 2;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-24 sm:pb-8">
      {/* Header */}
      <div className="mb-1">
        <Link href="/stocks" className="text-xs text-blue-500 hover:underline">
          ← 所有股票
        </Link>
      </div>
      <h1 className="text-2xl font-bold text-gray-800 mt-2">{detail.ticker}</h1>

      {analysis && (
        <Link
          href={`/analysis/${encodeURIComponent(analysis.key)}`}
          className="flex items-center justify-between mt-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 hover:border-blue-400 transition"
        >
          <div>
            <p className="text-sm font-medium text-blue-700">跨集數論點分析</p>
            <p className="text-xs text-blue-500 mt-0.5">
              已分析 {analysis.first_episode}–{analysis.last_episode}（{analysis.episode_count} 集）· {analysis.thread_count} 個主題
            </p>
          </div>
          <span className="text-blue-500">→</span>
        </Link>
      )}

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

      {/* Opinion Drift Section */}
      <div className="mt-8">
        {driftStatus === 'idle' && (
          <button
            onClick={handleFetchDrift}
            className="w-full py-2.5 text-sm font-medium text-blue-600 border border-blue-300 rounded-lg hover:bg-blue-50 transition"
          >
            查看觀點演變分析
          </button>
        )}

        {driftStatus === 'loading' && (
          <div className="flex items-center justify-center py-6 gap-2 text-gray-400 text-sm">
            <svg className="animate-spin h-4 w-4 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            分析中...
          </div>
        )}

        {driftStatus === 'error' && (
          <div className="text-center py-4">
            <p className="text-red-500 text-sm mb-2">載入失敗</p>
            <button
              onClick={handleFetchDrift}
              className="text-xs text-blue-500 hover:underline"
            >
              重試
            </button>
          </div>
        )}

        {driftStatus === 'done' && driftData && (
          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-3">觀點演變</h2>

            {!hasEnoughData ? (
              <p className="text-sm text-gray-400 py-4 text-center">資料不足，無法分析觀點演變</p>
            ) : (
              <>
                {/* Timeline list */}
                <div className="space-y-2 mb-4">
                  {driftTimelineRows.map((entry) => (
                    <div
                      key={entry.episode}
                      className="flex items-start gap-3 bg-white border border-gray-200 rounded-lg px-4 py-3"
                    >
                      <div className="shrink-0 text-right">
                        <p className="text-xs text-gray-400">{formatDate(entry.uploadDate)}</p>
                        <p className="text-xs text-gray-500">EP{entry.episode}</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <span
                          className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium mb-1 ${SENTIMENT_COLOR[entry.sentiment] ?? 'bg-gray-100 text-gray-600'}`}
                        >
                          {SENTIMENT_LABEL[entry.sentiment] ?? entry.sentiment}
                        </span>
                        <p className="text-xs text-gray-500 leading-relaxed">{entry.reason}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* AI drift analysis */}
                {driftData.driftAnalysis && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
                    <p className="text-xs font-semibold text-gray-500 mb-1">AI 分析</p>
                    <p className="text-sm text-gray-600 leading-relaxed">{driftData.driftAnalysis}</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
