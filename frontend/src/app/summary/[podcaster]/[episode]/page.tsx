'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useDispatch, useSelector } from 'react-redux';
import { fetchSummary } from '@/features/summarySlice';
import { AppDispatch, RootState } from '@/app/store';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatDate } from '@/utils';
import { MetadataSkeleton, SummarySkeleton } from './skeletons';

export default function EpisodeSummaryPage() {
  const { podcaster, episode } = useParams() as {
    podcaster: string;
    episode: string;
  };
  const dispatch = useDispatch<AppDispatch>();
  const { result, status, error } = useSelector((state: RootState) => state.summary);

  useEffect(() => {
    if (podcaster && episode) {
      dispatch(fetchSummary({ podcaster, episode }));
    }
  }, [podcaster, episode, dispatch]);

  if (status === 'loading' || status === 'idle') {
    return (
      <div className="flex flex-col items-center py-6 pb-24 sm:pb-8 md:py-8">
        <div className="w-full max-w-2xl px-4">
          <MetadataSkeleton />
          <SummarySkeleton />
        </div>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="flex justify-center items-center h-screen">
        <p className="text-lg font-semibold text-red-500">Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center py-6 pb-24 sm:pb-8 md:py-8">
      <div className="w-full max-w-2xl px-4">
        {/* Header */}
        <div className="mb-6">
          <p className="text-xs text-[#c4c2b8] mb-1">
            EP.{result?.episode} · {formatDate(result?.uploadDate ?? '')}
          </p>
          <h1 className="text-xl font-bold text-gray-900 leading-snug mb-2">
            {result?.title}
          </h1>
          <p className="text-xs text-[#c4c2b8]">
            {result?.podcaster}
          </p>
        </div>

        {/* Investment Thesis */}
        {result?.investment_thesis && (
          (result.investment_thesis.bullish.length > 0 ||
            result.investment_thesis.bearish.length > 0 ||
            result.investment_thesis.macro_view) && (
            <div className="mb-6">
              <h2 className="text-base font-bold text-gray-900 mb-3">投資觀點</h2>

              {result.investment_thesis.macro_view ? (
                <div className="mb-3 rounded-lg bg-gray-50 px-4 py-3">
                  <p className="text-xs font-semibold text-gray-500 mb-1">總體觀點</p>
                  <p className="text-sm text-gray-700 leading-relaxed">{result.investment_thesis.macro_view}</p>
                </div>
              ) : null}

              {result.investment_thesis.bullish.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-semibold text-green-600 mb-2">看多</p>
                  <div className="space-y-2">
                    {result.investment_thesis.bullish.map((item, i) => (
                      <div key={i} className="rounded-lg border border-green-200 bg-green-50 px-4 py-2">
                        <span className="text-sm font-semibold text-green-700">{item.stock}</span>
                        <p className="text-sm text-green-800 leading-relaxed mt-0.5">{item.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.investment_thesis.bearish.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-semibold text-red-500 mb-2">看空</p>
                  <div className="space-y-2">
                    {result.investment_thesis.bearish.map((item, i) => (
                      <div key={i} className="rounded-lg border border-red-200 bg-red-50 px-4 py-2">
                        <span className="text-sm font-semibold text-red-600">{item.stock}</span>
                        <p className="text-sm text-red-700 leading-relaxed mt-0.5">{item.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        )}

        {/* Summary */}
        {result?.note ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => (
                <h1 className="text-base font-bold text-gray-900 mt-6 mb-2">{children}</h1>
              ),
              h2: ({ children }) => (
                <h2 className="text-base font-bold text-gray-900 mt-6 mb-2">{children}</h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-sm font-semibold text-gray-700 mt-4 mb-1">{children}</h3>
              ),
              ul: ({ children }) => (
                <ul className="space-y-2 my-2">{children}</ul>
              ),
              ol: ({ children }) => (
                <ol className="space-y-2 my-2 list-decimal list-inside">{children}</ol>
              ),
              li: ({ children }) => (
                <li className="flex items-start gap-2 text-sm text-gray-700 leading-relaxed">
                  <span className="mt-[6px] w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0" />
                  <span>{children}</span>
                </li>
              ),
              p: ({ children }) => (
                <p className="text-sm text-gray-700 leading-relaxed my-2">{children}</p>
              ),
              strong: ({ children }) => (
                <strong className="font-semibold text-gray-900">{children}</strong>
              ),
            }}
          >
            {result.note}
          </ReactMarkdown>
        ) : (
          <p className="text-sm text-gray-500">No notes available.</p>
        )}
      </div>
    </div>
  );
}
