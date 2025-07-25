'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useDispatch, useSelector } from 'react-redux';
import { fetchSummary } from '@/features/summarySlice';
import { AppDispatch, RootState } from '@/app/store';
import { Divider } from '@nextui-org/react';

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
    <div className="flex flex-col items-center min-h-screen bg-gray-100 py-12 px-6">
      <div className="w-full max-w-3xl bg-white shadow-lg rounded-lg p-8">
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
            <span>{result?.uploadDate}</span>
          </div>
          <div className="flex justify-between items-center bg-green-100 text-green-600 px-4 py-3 rounded-lg shadow-md">
            <span className="font-semibold">Episode:</span>
            <span>{result?.episode}</span>
          </div>
        </div>

        <Divider />
        <div className="mt-8">
          <h3 className="text-xl font-semibold text-gray-800 mb-6">Notes:</h3>
          {result?.noteSections ? (
            <ul className="list-disc pl-8 space-y-4 text-gray-700">
              {result.noteSections.map((section, index) => (
                <li key={index} className="text-lg">
                  {section}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-lg text-gray-700">{result?.note}</p>
          )}
        </div>
      </div>
    </div>
  );
}
