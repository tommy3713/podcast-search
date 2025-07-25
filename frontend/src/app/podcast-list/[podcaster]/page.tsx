'use client';

import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchPodcasts, setPage } from '@/features/podcastListSlice';
import { AppDispatch, RootState } from '@/app/store';
import {
  Table,
  Pagination,
  TableHeader,
  TableColumn,
  TableBody,
  TableCell,
  TableRow,
  Link,
} from '@nextui-org/react';
import { useParams } from 'next/navigation';
const formatDate = (dateString: string): string => {
  const year = dateString.slice(0, 4);
  const month = dateString.slice(4, 6);
  const day = dateString.slice(6, 8);
  const date = new Date(`${year}-${month}-${day}`);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};
export default function GooayePodcastList() {
  const { podcaster } = useParams() as {
    podcaster: string;
  };
  const dispatch = useDispatch<AppDispatch>();
  const { podcasts, status, error, page, limit } = useSelector(
    (state: RootState) => state.podcastList
  );

  useEffect(() => {
    dispatch(fetchPodcasts({ page, limit }));
  }, [dispatch, page, limit]);

  const handlePageChange = (newPage: number) => {
    dispatch(setPage(newPage));
  };

  return (
    <div className="bg-white w-full flex flex-col items-center">
      <h1 className="text-2xl font-bold my-4">
        {podcaster.charAt(0).toUpperCase() + podcaster.slice(1)} Podcasts
      </h1>
      {status === 'loading' ? (
        <p>Loading...</p>
      ) : status === 'failed' ? (
        <p>Error: {error}</p>
      ) : (
        <div className="w-full max-w-4xl">
          <Table
            aria-label="Podcast List"
            style={{
              height: 'auto',
              minWidth: '100%',
            }}
          >
            <TableHeader>
              <TableColumn>Title</TableColumn>
              <TableColumn>Podcaster</TableColumn>
              <TableColumn>Episode</TableColumn>
              <TableColumn>Upload Date</TableColumn>
              <TableColumn>Actions</TableColumn>
            </TableHeader>
            <TableBody>
              {podcasts.map((podcast) => (
                <TableRow key={podcast.fullTitle}>
                  <TableCell>{podcast.title}</TableCell>
                  <TableCell>{podcast.podcaster}</TableCell>
                  <TableCell>{podcast.episode}</TableCell>
                  <TableCell>{formatDate(podcast.uploadDate)}</TableCell>
                  <TableCell>
                    <Link
                      href={`/summary/${podcast.podcaster}/${podcast.episode}`}
                      className="text-blue-500 hover:underline"
                    >
                      View Summary
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex justify-center mt-4">
            <Pagination
              total={Math.ceil(100 / limit)} // Replace 100 with the total number of podcasts
              initialPage={page}
              showControls
              onChange={handlePageChange}
            />
          </div>
        </div>
      )}
    </div>
  );
}
