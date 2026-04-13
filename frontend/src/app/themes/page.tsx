'use client';

import { useEffect, useState, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hook';
import { fetchThemesTimeline, THEMES, Theme, ThemeEpisode } from '@/features/themesSlice';
import Link from 'next/link';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

const THEME_COLORS: Record<Theme, string> = {
  '美股與科技股': '#2563eb',
  '台灣市場': '#16a34a',
  '總體經濟': '#d97706',
  '中國與新興市場': '#dc2626',
  '投資心理與哲學': '#7c3aed',
  '能源與原物料': '#ea580c',
  '債券與利率': '#0891b2',
  '加密貨幣': '#db2777',
  '房地產': '#65a30d',
};

type TimeRange = 'all' | '2y' | '1y';

function getMonthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function ThemesPage() {
  const dispatch = useAppDispatch();
  const { timeline, episodes, status } = useAppSelector((s) => s.themes);

  const [tab, setTab] = useState<'explore' | 'search'>('explore');
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [selectedThemes, setSelectedThemes] = useState<Set<Theme>>(new Set());

  useEffect(() => {
    if (status === 'idle' || status === 'failed' || (status === 'succeeded' && episodes.length === 0)) {
      dispatch(fetchThemesTimeline());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  // Build sorted months list filtered by time range
  const allMonths = useMemo(
    () => Object.keys(timeline).sort(),
    [timeline]
  );

  const filteredMonths = useMemo(() => {
    if (timeRange === 'all') return allMonths;
    const cutoff = timeRange === '1y' ? getMonthsAgo(12) : getMonthsAgo(24);
    return allMonths.filter((m) => m >= cutoff);
  }, [allMonths, timeRange]);

  // Build recharts data: [{ month: "2024-06", "美股與科技股": 2, ... }]
  const chartData = useMemo(
    () =>
      filteredMonths.map((month) => ({
        month,
        ...Object.fromEntries(
          THEMES.map((t) => [t, timeline[month]?.[t] ?? 0])
        ),
      })),
    [filteredMonths, timeline]
  );

  // Top 3 themes in last 3 months
  const top3 = useMemo(() => {
    const cutoff = getMonthsAgo(3);
    const counts: Record<string, number> = {};
    for (const [month, themes] of Object.entries(timeline)) {
      if (month < cutoff) continue;
      for (const [theme, count] of Object.entries(themes)) {
        counts[theme] = (counts[theme] || 0) + count;
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
  }, [timeline]);

  // Search tab: episodes filtered by selected themes
  const filteredEpisodes = useMemo(() => {
    if (selectedThemes.size === 0) return [];
    return episodes.filter((ep) =>
      ep.themes?.some((t) => selectedThemes.has(t as Theme))
    );
  }, [episodes, selectedThemes]);

  function toggleTheme(t: Theme) {
    setSelectedThemes((prev) => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });
  }

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-400 animate-pulse">載入中...</p>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-red-500">載入失敗，請確認後端服務正在運行。</p>
        <button
          onClick={() => dispatch(fetchThemesTimeline())}
          className="px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
        >
          重試
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 pb-24 sm:pb-8">
      <h1 className="text-xl font-bold text-gray-800 mb-4">主題趨勢時間軸</h1>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6">
        {(['explore', 'search'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              tab === t
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'explore' ? '探索' : '搜尋'}
          </button>
        ))}
      </div>

      {tab === 'explore' && (
        <div>
          {/* Top 3 cards */}
          {top3.length > 0 && (
            <div className="mb-6">
              <p className="text-xs text-gray-500 mb-2">近 3 個月最活躍主題</p>
              <div className="flex gap-3 flex-wrap">
                {top3.map(([theme, count]) => (
                  <div
                    key={theme}
                    className="px-3 py-2 rounded-lg text-sm font-medium text-white"
                    style={{ backgroundColor: THEME_COLORS[theme as Theme] ?? '#6b7280' }}
                  >
                    {theme}
                    <span className="ml-1 opacity-80 text-xs">({count})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Time range switcher */}
          <div className="flex gap-2 mb-4 justify-end">
            {(['all', '2y', '1y'] as TimeRange[]).map((r) => (
              <button
                key={r}
                onClick={() => setTimeRange(r)}
                className={`text-xs px-3 py-1 rounded-full border transition ${
                  timeRange === r
                    ? 'bg-blue-500 text-white border-blue-500'
                    : 'text-gray-600 border-gray-300 hover:border-blue-400'
                }`}
              >
                {r === 'all' ? '全部' : r === '2y' ? '近兩年' : '近一年'}
              </button>
            ))}
          </div>

          {/* Line chart — horizontal scroll on mobile */}
          <div className="overflow-x-auto">
            <div style={{ minWidth: 600 }}>
              <ResponsiveContainer width="100%" height={360}>
                <LineChart data={chartData} margin={{ top: 4, right: 16, left: -16, bottom: 4 }}>
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => v.slice(2)} // "2024-06" → "24-06"
                  />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    formatter={(value, name) => [value, name]}
                    labelFormatter={(label) => `${label}`}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {THEMES.map((theme) => (
                    <Line
                      key={theme}
                      type="monotone"
                      dataKey={theme}
                      stroke={THEME_COLORS[theme]}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {tab === 'search' && (
        <div>
          {/* Theme checkboxes */}
          <div className="flex flex-wrap gap-2 mb-6">
            {THEMES.map((theme) => (
              <button
                key={theme}
                onClick={() => toggleTheme(theme)}
                className={`px-3 py-1.5 rounded-full text-sm border transition ${
                  selectedThemes.has(theme)
                    ? 'text-white border-transparent'
                    : 'text-gray-700 border-gray-300 hover:border-blue-400'
                }`}
                style={
                  selectedThemes.has(theme)
                    ? { backgroundColor: THEME_COLORS[theme] }
                    : {}
                }
              >
                {theme}
              </button>
            ))}
          </div>

          {selectedThemes.size === 0 ? (
            <p className="text-gray-400 text-sm text-center mt-12">
              請選擇一個或多個主題
            </p>
          ) : filteredEpisodes.length === 0 ? (
            <p className="text-gray-400 text-sm text-center mt-12">
              沒有符合的集數
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                共 {filteredEpisodes.length} 集
              </p>
              {filteredEpisodes.map((ep) => (
                <EpisodeCard key={ep.fullTitle} ep={ep} selectedThemes={selectedThemes} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EpisodeCard({
  ep,
  selectedThemes,
}: {
  ep: ThemeEpisode;
  selectedThemes: Set<Theme>;
}) {
  const date = ep.uploadDate
    ? `${ep.uploadDate.slice(0, 4)}-${ep.uploadDate.slice(4, 6)}-${ep.uploadDate.slice(6, 8)}`
    : '';

  return (
    <Link
      href={`/summary/Gooaye/${ep.episode}`}
      className="block bg-white border border-gray-200 rounded-lg px-4 py-3 hover:border-blue-300 hover:shadow-sm transition"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-800 truncate">
            EP{ep.episode} {ep.title}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">{date}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {ep.themes?.map((t) => (
          <span
            key={t}
            className="text-xs px-2 py-0.5 rounded-full text-white"
            style={{
              backgroundColor: selectedThemes.has(t as Theme)
                ? THEME_COLORS[t as Theme]
                : '#9ca3af',
            }}
          >
            {t}
          </span>
        ))}
      </div>
    </Link>
  );
}
