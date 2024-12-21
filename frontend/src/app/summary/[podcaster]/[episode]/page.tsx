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
    if ((podcaster, episode)) {
      dispatch(fetchSummary({ podcaster, episode }));
    }
  }, [podcaster, episode, dispatch]);

  if (status === 'loading' || status === 'idle') return <p>Loading...</p>;
  if (status === 'failed') return <p>Error: {error}</p>;

  return (
    <div className="mt-12 flex justify-center">
      <Card className="w-3/4">
        <CardHeader>
          <h3>Podcast Episode Details</h3>
        </CardHeader>
        <CardBody>
          <h4>
            <strong>Title:</strong> {result?.fullTitle}
          </h4>
          <p>
            <strong>Podcaster:</strong> {result?.podcaster}
          </p>
          <p>
            <strong>Upload Date:</strong> {result?.uploadDate}
          </p>
          <p>
            <strong>Episode:</strong> {result?.episode}
          </p>
          <p>
            <strong>Note:</strong>
          </p>
          <p>{result?.note}</p>
        </CardBody>
      </Card>
    </div>
  );
}
