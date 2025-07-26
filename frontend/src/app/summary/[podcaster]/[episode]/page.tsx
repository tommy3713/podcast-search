'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useDispatch, useSelector } from 'react-redux';
import { fetchSummary, fetchTranscript } from '@/features/summarySlice';
import { AppDispatch, RootState } from '@/app/store';
import { Button, Divider, Spinner } from '@nextui-org/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatDate } from '@/utlis';

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

  const paragraphs = useMemo(() => {
    if (!transcript) return [];
    const regex = /[\s\S]{1,350}/g;
    return transcript.match(regex) || [transcript];
  }, [transcript]);

  const [isTranscriptVisible, setTranscriptVisible] = useState(false);

  useEffect(() => {
    if (podcaster && episode) {
      dispatch(fetchSummary({ podcaster, episode }));
    }
  }, [podcaster, episode, dispatch]);
  useEffect(() => {
    if (isTranscriptVisible) {
      dispatch(fetchTranscript({ podcaster, episode }));
    }
  }, [isTranscriptVisible, dispatch, podcaster, episode]);

  if (status === 'loading' || status === 'idle') {
    return (
      <div className="flex justify-center items-center h-screen bg-gray-50">
        <p className="text-lg font-semibold text-gray-600">Loading...</p>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="flex justify-center items-center h-screen bg-gray-50">
        <p className="text-lg font-semibold text-red-500">Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center min-h-screen bg-gray-10 pt-4">
      <div className="w-full md:w-2/3  bg-white shadow-lg rounded-lg p-2  md:p-8">
        <div className="flex flex-col gap-4 mb-8">
          <div className="flex justify-between items-center bg-gray-100 text-gray-800 px-4 py-3 rounded-lg shadow-md">
            <span className="font-semibold">Title</span>
            <span>{result?.title}</span>
          </div>
          <div className="flex justify-between items-center bg-blue-100 text-blue-600 px-4 py-3 rounded-lg shadow-md">
            <span className="font-semibold">Podcaster:</span>
            <span>{result?.podcaster}</span>
          </div>
          <div className="flex justify-between items-center bg-purple-100 text-purple-600 px-4 py-3 rounded-lg shadow-md">
            <span className="font-semibold">Upload Date:</span>
            <span>{formatDate(result?.uploadDate ?? '')}</span>
          </div>
          <div className="flex justify-between items-center bg-green-100 text-green-600 px-4 py-3 rounded-lg shadow-md">
            <span className="font-semibold">Episode:</span>
            <span>{result?.episode}</span>
          </div>
        </div>

        <Divider />
        <div className="mt-8">
          <h3 className="flex justify-between items-center bg-red-100 text-red-600 px-4 py-3 rounded-lg shadow-md">
            Notes:
          </h3>
          {result?.note ? (
            <div className="prose max-w-none text-gray-700">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {result.note}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="text-lg text-gray-700">No notes available.</p>
          )}
        </div>
        <Divider />
        <div className="mt-8">
          <Button
            color="primary"
            className="mb-4 w-full md:w-auto"
            onClick={() => {
              setTranscriptVisible(!isTranscriptVisible);
            }}
          >
            {isTranscriptVisible ? '收起逐字稿' : '查看完整逐字稿'}
          </Button>
          {isTranscriptVisible && (
            <div className="prose max-w-none text-gray-700 p-4 border rounded-lg">
              {transcriptStatus === 'loading' ? (
                <div className="flex items-center gap-2">
                  <Spinner size="sm" /> 加載逐字稿…
                </div>
              ) : transcriptStatus === 'failed' ? (
                <p className="text-red-500">Error: {transcriptError}</p>
              ) : (
                paragraphs.map((p, idx) => (
                  <div key={idx} className="mb-4">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {p.trim()}
                    </ReactMarkdown>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
