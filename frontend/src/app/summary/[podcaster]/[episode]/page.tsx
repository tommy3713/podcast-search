'use client';
import { Card, CardHeader, CardBody } from '@nextui-org/react';
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
  console.log('Redux State:', { status, error });
  if (status === 'failed') {
    console.log('Error', error);
  }
  if (status === 'loading' || status === 'idle') return <p>Loading...</p>;
  if (status === 'failed') return <p>Error: {error}</p>;

  return (
    <div className="mt-12 flex justify-center">
      <Card className="w-3/4">
        <CardHeader>
          <h3 className="text-2xl font-bold">Podcast Episode Details</h3>
        </CardHeader>
        <CardBody>
          <div>
            <h4 className="">
              <strong>Title:</strong> {result?.fullTitle}
            </h4>
          </div>
          <div className="text-gray-700">
            <p>
              <strong>Podcaster:</strong> {result?.podcaster}
            </p>
            <p>
              <strong>Upload Date:</strong> {result?.uploadDate}
            </p>
            <p>
              <strong>Episode:</strong> {result?.episode}
            </p>
          </div>
          <div>
            <h4 className="text-lg font-semibold">Notes:</h4>
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
        </CardBody>
      </Card>
    </div>
  );
}
