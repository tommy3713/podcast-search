'use client';
import { useEffect, useRef } from 'react';
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
import { formatDate } from '@/utlis';
import { ChevronLeft, ChevronRight } from 'lucide-react';
export default function GooayePodcastList() {
  const { podcaster } = useParams() as {
    podcaster: string;
  };
  const dispatch = useDispatch<AppDispatch>();
  const { podcasts, status, error, page, limit } = useSelector(
    (state: RootState) => state.podcastList
  );
  const isInitialLoading = status === 'loading' && podcasts.length === 0;
  const isError = status === 'failed';

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

      {isInitialLoading ? (
        <p>Loading...</p>
      ) : isError ? (
        <p>Error: {error}</p>
      ) : (
        <div className="w-full max-w-4xl">
          {/* Mobile: Load More button */}
          <div className="w-full sm:hidden px-4 mb-2">
            <div className="flex justify-between items-center text-sm">
              <button
                onClick={() => handlePageChange(Math.max(1, page - 1))}
                disabled={page === 1}
                className={`flex items-center gap-1 px-4 py-2 rounded-full border font-medium transition-all shadow-sm 
        ${
          page === 1
            ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
            : 'bg-white hover:bg-blue-100 text-blue-600 border-blue-300'
        }`}
              >
                <ChevronLeft size={16} />
                Prev
              </button>
              <span className="text-gray-600">
                Page <strong>{page}</strong> of{' '}
                <strong>{Math.ceil(100 / limit)}</strong>
              </span>
              <button
                onClick={() =>
                  handlePageChange(Math.min(Math.ceil(100 / limit), page + 1))
                }
                disabled={page === Math.ceil(100 / limit)}
                className={`flex items-center gap-1 px-4 py-2 rounded-full border font-medium transition-all shadow-sm 
        ${
          page === Math.ceil(100 / limit)
            ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
            : 'bg-white hover:bg-blue-100 text-blue-600 border-blue-300'
        }`}
              >
                Next
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
          {/* Desktop table */}
          <div className="hidden sm:block">
            <Table aria-label="Podcast List" className="w-full">
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
          </div>

          {/* Mobile stacked cards */}

          <div className="block sm:hidden space-y-4 px-4">
            {podcasts.map((podcast) => (
              <Link
                key={podcast.fullTitle}
                href={`/summary/${podcast.podcaster}/${podcast.episode}`}
                className="block border border-gray-200 rounded-xl p-4 shadow-sm bg-white hover:bg-blue-50 transition"
              >
                <div className="flex justify-between items-center">
                  <p className="font-semibold text-base text-gray-900 mb-1">
                    {podcast.title}
                  </p>

                  <span className="text-blue-600 text-sm font-medium">
                    View Summary →
                  </span>
                </div>
                <div className="text-sm text-gray-600 grid grid-cols-2 gap-y-2">
                  <p>
                    <span className="font-medium">Podcaster:</span>{' '}
                    {podcast.podcaster}
                  </p>
                  <p>
                    <span className="font-medium">Episode:</span>{' '}
                    {podcast.episode}
                  </p>
                  <p className="col-span-2">
                    <span className="font-medium">Upload Date:</span>{' '}
                    {formatDate(podcast.uploadDate)}
                  </p>
                </div>
              </Link>
            ))}
          </div>

          {/* Responsive Pagination */}
          <div className="flex justify-center mt-4">
            {/* Desktop: full controls */}
            <div className="hidden sm:block">
              <Pagination
                total={Math.ceil(100 / limit)}
                initialPage={page}
                showControls
                onChange={handlePageChange}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
