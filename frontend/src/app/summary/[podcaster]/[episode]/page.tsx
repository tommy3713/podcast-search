'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useDispatch, useSelector } from 'react-redux';
import { fetchSummary, fetchTranscript } from '@/features/summarySlice';
import { AppDispatch, RootState } from '@/app/store';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatDate } from '@/utils';
import { formatTimestamp, groupSegments } from '@/utils/transcript';
import { MetadataSkeleton, SummarySkeleton, TranscriptSkeleton } from './skeletons';

type Tab = 'summary' | 'transcript';

function highlightText(text: string, term: string): React.ReactNode[] {
  if (!term.trim()) return [text];
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  const testRe = new RegExp(`^${escaped}$`, 'i');
  return parts.map((part, i) =>
    testRe.test(part) ? (
      <mark key={i} className="bg-yellow-200 text-gray-900 rounded px-0.5">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

export default function EpisodeSummaryPage() {
  const { podcaster, episode } = useParams() as {
    podcaster: string;
    episode: string;
  };
  const dispatch = useDispatch<AppDispatch>();
  const {
    result,
    status,
    error,
    transcript,
    transcriptSegments,
    transcriptStatus,
    transcriptError,
  } = useSelector((state: RootState) => state.summary);
  const [activeTab, setActiveTab] = useState<Tab>('summary');
  const [searchTerm, setSearchTerm] = useState('');

  const handleTabClick = useCallback(
    (tab: Tab) => {
      setActiveTab(tab);
      if (tab === 'transcript' && transcriptStatus === 'idle') {
        dispatch(fetchTranscript({ podcaster, episode }));
      }
    },
    [transcriptStatus, dispatch, podcaster, episode]
  );

  const matchCount = useMemo(() => {
    if (!transcript || !searchTerm.trim()) return 0;
    const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return (transcript.match(new RegExp(escaped, 'gi')) ?? []).length;
  }, [transcript, searchTerm]);

  const paragraphs = useMemo(
    () => (transcriptSegments?.length ? groupSegments(transcriptSegments) : null),
    [transcriptSegments]
  );

  useEffect(() => {
    if (podcaster && episode) {
      dispatch(fetchSummary({ podcaster, episode }));
      setActiveTab('summary');
      setSearchTerm('');
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

        {/* Tab switcher */}
        <div className="flex border-b border-gray-200 mb-6">
          {(['summary', 'transcript'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => handleTabClick(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {tab === 'summary' ? '摘要' : '逐字稿'}
            </button>
          ))}
        </div>

        {/* Summary tab */}
        {activeTab === 'summary' && (
          <>
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
          </>
        )}

        {/* Transcript tab */}
        {activeTab === 'transcript' && (
          <div>
            {transcriptStatus === 'loading' && <TranscriptSkeleton />}
            {transcriptStatus === 'failed' && (
              <p className="text-sm text-red-500">{transcriptError}</p>
            )}
            {transcriptStatus === 'succeeded' && (
              <>
                <div className="mb-4 flex items-center gap-2">
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyDown={(e) => { if (e.nativeEvent.isComposing) e.stopPropagation(); }}
                    placeholder="搜尋關鍵字..."
                    className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
                  />
                  {searchTerm.trim() && (
                    <span className="text-xs text-gray-400 whitespace-nowrap">
                      {matchCount} 個結果
                    </span>
                  )}
                </div>
                {paragraphs ? (
                  <div className="space-y-4">
                    {paragraphs.map((para) => (
                      <div key={para.start} className="flex gap-3">
                        <span className="w-14 shrink-0 pt-0.5 text-xs text-[#c4c2b8] tabular-nums">
                          {formatTimestamp(para.start)}
                        </span>
                        <p className="text-sm text-gray-700 leading-relaxed">
                          {highlightText(para.text, searchTerm)}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : transcript ? (
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                    {highlightText(transcript, searchTerm)}
                  </p>
                ) : (
                  <p className="text-sm text-gray-500">逐字稿尚未提供。</p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
