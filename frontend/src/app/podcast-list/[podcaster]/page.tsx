'use client';
import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchPodcasts } from '@/features/podcastListSlice';
import { AppDispatch, RootState } from '@/app/store';
import { useParams } from 'next/navigation';
import { formatDate } from '@/utlis';
import Link from 'next/link';

const LOAD_STEP = 20;

function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s*/g, '')
    .replace(/\*\*|__|\*|_/g, '')
    .replace(/^-\s+/gm, '')
    .replace(/\n+/g, ' ')
    .trim();
}

export default function GooayePodcastList() {
  const { podcaster } = useParams() as { podcaster: string };
  const dispatch = useDispatch<AppDispatch>();
  const { podcasts, status, error } = useSelector(
    (state: RootState) => state.podcastList
  );
  const isInitialLoading = status === 'loading' && podcasts.length === 0;
  const isError = status === 'failed';

  const [year, setYear] = useState('all');
  const [month, setMonth] = useState('all');
  const [visibleCount, setVisibleCount] = useState(LOAD_STEP);

  useEffect(() => {
    dispatch(fetchPodcasts({ page: 1, limit: 200 }));
  }, [dispatch]);

  // Derive available years from loaded podcasts
  const years = useMemo(() => {
    const set = new Set(podcasts.map((p) => p.uploadDate.slice(0, 4)));
    return Array.from(set).sort((a, b) => Number(b) - Number(a));
  }, [podcasts]);

  // Derive available months for selected year
  const months = useMemo(() => {
    const set = new Set(
      podcasts
        .filter((p) => year === 'all' || p.uploadDate.slice(0, 4) === year)
        .map((p) => p.uploadDate.slice(4, 6))
    );
    return Array.from(set).sort((a, b) => Number(a) - Number(b));
  }, [podcasts, year]);

  // Filter by year + month
  const filtered = useMemo(() => {
    return podcasts.filter((p) => {
      const matchYear = year === 'all' || p.uploadDate.slice(0, 4) === year;
      const matchMonth = month === 'all' || p.uploadDate.slice(4, 6) === month;
      return matchYear && matchMonth;
    });
  }, [podcasts, year, month]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

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
          {/* Toolbar */}
          <div className="flex items-center gap-2 mb-4">
            <select
              value={year}
              onChange={(e) => { setYear(e.target.value); setMonth('all'); setVisibleCount(LOAD_STEP); }}
              className="bg-white border border-[#e8e6dd] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#b8b6ac] transition-colors"
            >
              <option value="all">所有年份</option>
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <select
              value={month}
              onChange={(e) => { setMonth(e.target.value); setVisibleCount(LOAD_STEP); }}
              className="bg-white border border-[#e8e6dd] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#b8b6ac] transition-colors"
            >
              <option value="all">所有月份</option>
              {months.map((m) => (
                <option key={m} value={m}>{Number(m)} 月</option>
              ))}
            </select>
            <span className="text-xs text-[#c4c2b8] whitespace-nowrap ml-auto">
              共 {filtered.length} 集
            </span>
          </div>

          {/* Card list */}
          <div className="flex flex-col gap-y-2">
            {visible.map((podcast) => {
              const notePreview = podcast.note ? stripMarkdown(podcast.note) : '';
              const episodeYear = podcast.uploadDate.slice(0, 4);
              return (
                <Link
                  key={podcast.fullTitle}
                  href={`/summary/${podcast.podcaster}/${podcast.episode}`}
                >
                  <div className="bg-white border border-[#e8e6dd] rounded-lg hover:border-[#b8b6ac] transition-colors px-4 py-3 flex items-start gap-x-4">
                    {/* Left: episode + year */}
                    <div className="shrink-0 w-12 flex flex-col items-start">
                      <span className="text-base font-medium text-gray-800 leading-tight">
                        {podcast.episode}
                      </span>
                      <span className="text-xs text-[#c4c2b8]">{episodeYear}</span>
                    </div>

                    {/* Middle: title + note preview */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {podcast.title}
                      </p>
                      {notePreview && (
                        <p className="text-xs text-[#999] mt-0.5 line-clamp-2 leading-relaxed">
                          {notePreview}
                        </p>
                      )}
                    </div>

                    {/* Right: date + arrow */}
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <span className="text-xs text-[#c4c2b8]">
                        {formatDate(podcast.uploadDate)}
                      </span>
                      <span className="text-[#c4c2b8] text-lg leading-none">›</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Load more */}
          {hasMore && (
            <button
              onClick={() => setVisibleCount((c) => c + LOAD_STEP)}
              className="w-full mt-4 py-2.5 text-sm text-gray-600 bg-white border border-[#e8e6dd] rounded-lg hover:border-[#b8b6ac] transition-colors"
            >
              載入更多集數
            </button>
          )}
        </div>
      )}
    </div>
  );
}
