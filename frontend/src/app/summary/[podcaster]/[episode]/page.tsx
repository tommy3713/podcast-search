'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useDispatch, useSelector } from 'react-redux';
import { fetchSummary } from '@/features/summarySlice';
import { AppDispatch, RootState } from '@/app/store';

export default function EpisodeSummaryPage() {
  const { podcaster, episode } = useParams() as {
    podcaster: string;
    episode: string;
  };
  const dispatch = useDispatch<AppDispatch>();
  const { result, status, error } = useSelector(
    (state: RootState) => state.summary
  );

  useEffect(() => {
    if (podcaster && episode) {
      dispatch(fetchSummary({ podcaster, episode }));
    }
  }, [podcaster, episode, dispatch]);

  if (status === 'loading' || status === 'idle') {
    return (
      <div className="flex justify-center items-center h-screen">
        <p className="text-lg font-semibold text-gray-600">Loading...</p>
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
    <div className="flex flex-col items-center min-h-screen bg-gray-50 py-8 px-4">
      <div className="w-full max-w-4xl bg-white shadow-md rounded-lg p-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-6">
          Podcast Episode Details
        </h1>
        <div className="mb-4">
          <h2 className="text-xl font-semibold text-gray-700">
            <strong>Title:</strong> {result?.fullTitle}
          </h2>
        </div>
        <div className="mb-4 text-gray-700">
          <p className="mb-2">
            <strong>Podcaster:</strong> {result?.podcaster}
          </p>
          <p className="mb-2">
            <strong>Upload Date:</strong> {result?.uploadDate}
          </p>
          <p className="mb-2">
            <strong>Episode:</strong> {result?.episode}
          </p>
        </div>
        <div className="mt-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Notes:</h3>
          {result?.noteSections ? (
            <ul className="list-disc pl-6 space-y-2 text-gray-700">
              {result.noteSections.map((section, index) => (
                <li key={index}>{section}</li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-700">{result?.note}</p>
          )}
        </div>
      </div>
    </div>
  );
}
