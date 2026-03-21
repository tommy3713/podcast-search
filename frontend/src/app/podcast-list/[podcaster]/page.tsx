'use client';
import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchPodcasts, setPage } from '@/features/podcastListSlice';
import { AppDispatch, RootState } from '@/app/store';
import { Pagination } from '@nextui-org/react';
import { useParams } from 'next/navigation';
import { formatDate } from '@/utlis';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';

export default function GooayePodcastList() {
  const { podcaster } = useParams() as { podcaster: string };
  const dispatch = useDispatch<AppDispatch>();
  const { podcasts, status, error, page, limit } = useSelector(
    (state: RootState) => state.podcastList
  );
  const isInitialLoading = status === 'loading' && podcasts.length === 0;
  const isError = status === 'failed';
  const totalPages = Math.ceil(100 / limit);

  useEffect(() => {
    dispatch(fetchPodcasts({ page, limit }));
  }, [dispatch, page, limit]);

  const handlePageChange = (newPage: number) => {
    dispatch(setPage(newPage));
  };

  return (
    <div className="w-full flex flex-col items-center">
      <h1 className="text-2xl font-bold my-4">
        {podcaster.charAt(0).toUpperCase() + podcaster.slice(1)} Podcasts
      </h1>

      {isInitialLoading ? (
        <p>Loading...</p>
      ) : isError ? (
        <p>Error: {error}</p>
      ) : (
        <div className="w-full max-w-2xl px-4">
          <div className="flex flex-col gap-y-2">
            {podcasts.map((podcast) => (
              <Link
                key={podcast.fullTitle}
                href={`/summary/${podcast.podcaster}/${podcast.episode}`}
              >
                <div className="bg-white border border-[#e8e6dd] rounded-lg hover:border-[#b8b6ac] transition-colors px-4 py-3 flex items-center gap-x-4">
                  <span className="font-medium text-gray-800 w-10 shrink-0">
                    {podcast.episode}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {podcast.title}
                    </p>
                    <p className="text-xs text-[#c4c2b8] mt-0.5">
                      {formatDate(podcast.uploadDate)}
                    </p>
                  </div>
                  <span className="text-[#c4c2b8] text-lg shrink-0">›</span>
                </div>
              </Link>
            ))}
          </div>

          {/* Mobile pagination */}
          <div className="sm:hidden flex justify-between items-center text-sm mt-4">
            <button
              onClick={() => handlePageChange(Math.max(1, page - 1))}
              disabled={page === 1}
              className={`flex items-center gap-1 px-4 py-2 rounded-full border font-medium transition-all
                ${page === 1 ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-white text-gray-600 border-[#e8e6dd] hover:border-[#b8b6ac]'}`}
            >
              <ChevronLeft size={16} />
              Prev
            </button>
            <span className="text-gray-600">
              Page <strong>{page}</strong> of <strong>{totalPages}</strong>
            </span>
            <button
              onClick={() => handlePageChange(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className={`flex items-center gap-1 px-4 py-2 rounded-full border font-medium transition-all
                ${page === totalPages ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-white text-gray-600 border-[#e8e6dd] hover:border-[#b8b6ac]'}`}
            >
              Next
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Desktop pagination */}
          <div className="hidden sm:flex justify-center mt-4">
            <Pagination
              total={totalPages}
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
