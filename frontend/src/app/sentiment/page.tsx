'use client';

import { useEffect, useState, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hook';
import {
  fetchSentimentTimeline,
  SentimentPoint,
} from '@/features/sentimentSlice';
import Link from 'next/link';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Dot,
} from 'recharts';

type TimeRange = 'all' | '2y' | '1y';

function getDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  // Return as "YYYYMMDD" to compare with uploadDate
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function labelColor(label: string): string {
  if (label === '樂觀') return '#16a34a';
  if (label === '悲觀') return '#dc2626';
  return '#d97706'; // 謹慎 = amber
}

function formatDate(uploadDate: string): string {
  if (!uploadDate || uploadDate.length < 6) return uploadDate;
  return `${uploadDate.slice(2, 4)}-${uploadDate.slice(4, 6)}`;
}

function formatFullDate(uploadDate: string): string {
  if (!uploadDate || uploadDate.length < 8) return uploadDate;
  return `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}`;
}

interface CustomDotProps {
  cx?: number;
  cy?: number;
  payload?: SentimentPoint;
}

function CustomDot({ cx, cy, payload }: CustomDotProps) {
  if (cx === undefined || cy === undefined || !payload) return null;
  const color = labelColor(payload.label);
  const href = `/summary/Gooaye/${payload.episode}`;

  return (
    <a href={href}>
      <circle
        cx={cx}
        cy={cy}
        r={5}
        fill={color}
        stroke="#fff"
        strokeWidth={1.5}
        style={{ cursor: 'pointer' }}
      />
    </a>
  );
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: SentimentPoint }>;
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  const color = labelColor(point.label);

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 max-w-xs text-sm">
      <p className="font-semibold text-gray-800 mb-1">
        EP{point.episode} {point.title}
      </p>
      <p className="text-xs text-gray-400 mb-1">
        {formatFullDate(point.uploadDate)}
      </p>
      <p className="font-medium mb-1" style={{ color }}>
        {point.label}（{point.score >= 0 ? '+' : ''}
        {point.score.toFixed(2)}）
      </p>
      {point.reason && (
        <p className="text-xs text-gray-600 leading-relaxed">{point.reason}</p>
      )}
    </div>
  );
}

export default function SentimentPage() {
  const dispatch = useAppDispatch();
  const { timeline, status } = useAppSelector((s) => s.sentiment);

  const [timeRange, setTimeRange] = useState<TimeRange>('all');

  useEffect(() => {
    if (status === 'idle' || status === 'failed' || (status === 'succeeded' && timeline.length === 0)) {
      dispatch(fetchSentimentTimeline());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  const filteredTimeline = useMemo(() => {
    if (timeRange === 'all') return timeline;
    const cutoff = timeRange === '1y' ? getDaysAgo(365) : getDaysAgo(730);
    return timeline.filter((p) => p.uploadDate >= cutoff);
  }, [timeline, timeRange]);

  const chartData = useMemo(
    () =>
      filteredTimeline.map((p) => ({
        ...p,
        dateLabel: formatDate(p.uploadDate),
      })),
    [filteredTimeline],
  );

  const sortedByScore = useMemo(
    () => [...filteredTimeline].sort((a, b) => b.score - a.score),
    [filteredTimeline],
  );

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
          onClick={() => dispatch(fetchSentimentTimeline())}
          className="px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
        >
          重試
        </button>
      </div>
    );
  }

  if (status === 'succeeded' && timeline.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-400 text-sm">目前沒有情緒分析資料</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 pb-24 sm:pb-8">
      <h1 className="text-xl font-bold text-gray-800 mb-4">市場情緒時間軸</h1>

      {/* Legend */}
      <div className="flex gap-4 mb-4 flex-wrap">
        {(['樂觀', '謹慎', '悲觀'] as const).map((label) => (
          <div key={label} className="flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-3 rounded-full"
              style={{ backgroundColor: labelColor(label) }}
            />
            <span className="text-xs text-gray-600">{label}</span>
          </div>
        ))}
      </div>

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

      {/* Chart — horizontal scroll on mobile */}
      <div className="overflow-x-auto">
        <div style={{ minWidth: 600 }}>
          <ResponsiveContainer width="100%" height={360}>
            <ComposedChart
              data={chartData}
              margin={{ top: 8, right: 16, left: -16, bottom: 4 }}
            >
              <XAxis dataKey="dateLabel" tick={{ fontSize: 11 }} />
              <YAxis domain={[-1, 1]} tick={{ fontSize: 11 }} tickCount={5} />
              <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="4 3" />
              <ReferenceLine
                y={0.3}
                stroke="#16a34a"
                strokeDasharray="4 3"
                label={{
                  value: '樂觀',
                  position: 'right',
                  fontSize: 10,
                  fill: '#16a34a',
                }}
              />
              <ReferenceLine
                y={-0.3}
                stroke="#dc2626"
                strokeDasharray="4 3"
                label={{
                  value: '悲觀',
                  position: 'right',
                  fontSize: 10,
                  fill: '#dc2626',
                }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey="score"
                stroke="#6366f1"
                strokeWidth={2}
                dot={(props) => (
                  <CustomDot
                    key={props.index}
                    cx={props.cx}
                    cy={props.cy}
                    payload={props.payload}
                  />
                )}
                activeDot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Episode list sorted by score */}
      <div className="mt-8">
        <h2 className="text-base font-semibold text-gray-700 mb-3">
          集數情緒排行（由高至低）
        </h2>
        {sortedByScore.length === 0 ? (
          <p className="text-gray-400 text-sm text-center mt-4">
            沒有符合的資料
          </p>
        ) : (
          <div className="space-y-2">
            {sortedByScore.map((ep) => {
              const color = labelColor(ep.label);
              const date = formatFullDate(ep.uploadDate);
              return (
                <Link
                  key={ep.fullTitle}
                  href={`/summary/Gooaye/${ep.episode}`}
                  className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg px-4 py-3 hover:border-blue-300 hover:shadow-sm transition"
                >
                  {/* Label badge */}
                  <span
                    className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full text-white"
                    style={{ backgroundColor: color }}
                  >
                    {ep.label}
                  </span>
                  {/* Score */}
                  <span
                    className="shrink-0 text-sm font-bold w-12 text-right"
                    style={{ color }}
                  >
                    {ep.score >= 0 ? '+' : ''}
                    {ep.score.toFixed(2)}
                  </span>
                  {/* Title */}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      EP{ep.episode} {ep.title}
                    </p>
                    <p className="text-xs text-gray-400">{date}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
