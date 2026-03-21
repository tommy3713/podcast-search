'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useDispatch, useSelector } from 'react-redux';
import { fetchSummary, fetchTranscript } from '@/features/summarySlice';
import { AppDispatch, RootState } from '@/app/store';
import { Spinner } from '@nextui-org/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatDate } from '@/utlis';
import LoadingComponent from '@/app/loading';

type Tab = 'summary' | 'transcript';

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
    transcriptStatus,
    transcriptError,
  } = useSelector((state: RootState) => state.summary);

  const [activeTab, setActiveTab] = useState<Tab>('summary');

  const paragraphs = useMemo(() => {
    if (!transcript) return [];
    const regex = /[\s\S]{1,350}/g;
    return transcript.match(regex) || [transcript];
  }, [transcript]);

  useEffect(() => {
    if (podcaster && episode) {
      dispatch(fetchSummary({ podcaster, episode }));
    }
  }, [podcaster, episode, dispatch]);

  useEffect(() => {
    if (activeTab === 'transcript') {
      dispatch(fetchTranscript({ podcaster, episode }));
    }
  }, [activeTab, dispatch, podcaster, episode]);

  if (status === 'loading' || status === 'idle') {
    return <LoadingComponent />;
  }

  if (status === 'failed') {
    return (
      <div className="flex justify-center items-center h-screen">
        <p className="text-lg font-semibold text-red-500">Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center pt-6 pb-20 sm:pb-8">
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

        {/* Tabs */}
        <div className="flex border-b border-[#e8e6dd] mb-6">
          {(['summary', 'transcript'] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab
                  ? 'border-gray-800 text-gray-800'
                  : 'border-transparent text-[#c4c2b8] hover:text-gray-600'
              }`}
            >
              {tab === 'summary' ? '摘要' : '逐字稿'}
            </button>
          ))}
        </div>

        {/* Summary tab */}
        {activeTab === 'summary' && (
          <div>
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
        )}

        {/* Transcript tab */}
        {activeTab === 'transcript' && (
          <div>
            {transcriptStatus === 'loading' ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Spinner size="sm" /> 加載逐字稿…
              </div>
            ) : transcriptStatus === 'failed' ? (
              <p className="text-sm text-red-500">Error: {transcriptError}</p>
            ) : (
              <div className="space-y-4">
                {paragraphs.map((p, idx) => (
                  <p key={idx} className="text-sm text-gray-700 leading-relaxed">
                    {p.trim()}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
