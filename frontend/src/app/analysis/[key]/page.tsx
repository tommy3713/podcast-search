'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAppDispatch, useAppSelector } from '@/app/hook';
import { fetchAnalysis, Relation, Thread, ThreadEntry } from '@/features/analysisSlice';
import {
  Bucket,
  RANGE_LABEL,
  RELATION_SYMBOL,
  ThreadGroup,
  ThreadSummary,
  cellRelation,
  episodeNumber,
  formatDate,
  recentChanges,
  summarizeThreads,
  timeBuckets,
} from '@/utils/analysis';

type Tab = 'changes' | 'overview';

const RELATION_COLOR: Record<Relation, string> = {
  新增: 'text-blue-600',
  更新: 'text-emerald-600',
  反轉: 'text-red-600',
  重複: 'text-gray-400',
};

const RELATION_BADGE: Record<Relation, string> = {
  新增: 'bg-blue-50 text-blue-700',
  更新: 'bg-emerald-50 text-emerald-700',
  反轉: 'bg-red-50 text-red-700',
  重複: 'bg-gray-100 text-gray-500',
};

const GROUP_LABEL: Record<Exclude<ThreadGroup, 'active'>, string> = {
  dormant: '沉寂（最近 3 集都沒提到）',
  background: '只當背景提到',
};

function RelationBadge({ relation }: { relation: Relation }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${RELATION_BADGE[relation]}`}>
      {relation}
    </span>
  );
}

function EntryCard({ entry, threadLabel, onThread }: { entry: ThreadEntry; threadLabel?: string; onThread?: () => void }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
      <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500 mb-1.5">
        <RelationBadge relation={entry.relation} />
        <span>
          {entry.episode} · {formatDate(entry.date)}
        </span>
        {entry.focus === '背景' && (
          <span className="px-1.5 py-0.5 border border-gray-200 rounded text-gray-400">背景</span>
        )}
        {threadLabel &&
          (onThread ? (
            <button onClick={onThread} className="text-blue-500 hover:underline text-left">
              {threadLabel} →
            </button>
          ) : (
            <span>{threadLabel}</span>
          ))}
      </div>
      <p className="text-sm text-gray-800 leading-relaxed">{entry.reason}</p>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-gray-400 hover:text-gray-600 select-none">逐字稿原文</summary>
        <p className="mt-1.5 text-gray-500 leading-relaxed whitespace-pre-wrap">{entry.reference}</p>
        <Link
          href={`/summary/Gooaye/${episodeNumber(entry.episode)}`}
          className="inline-block mt-1.5 text-blue-500 hover:underline"
        >
          打開這集逐字稿 →
        </Link>
      </details>
    </div>
  );
}

function ThreadTimeline({ thread, onBack }: { thread: Thread; onBack: () => void }) {
  const entries = [...thread.history].sort((a, b) => b.date.localeCompare(a.date));
  const episodes = new Set(thread.history.map((h) => h.episode)).size;
  return (
    <div>
      <button onClick={onBack} className="text-xs text-blue-500 hover:underline mb-3">
        ← 回到列表
      </button>
      <h2 className="text-lg font-semibold text-gray-800">{thread.label}</h2>
      <p className="text-xs text-gray-400 mt-1 mb-4">
        {episodes} 集、{thread.history.length} 條，新的在上面
      </p>
      <ol className="relative border-l border-gray-200 ml-2 space-y-3">
        {entries.map((entry, i) => (
          <li key={`${entry.episode}-${i}`} className="ml-4">
            <span
              className={`absolute -left-[7px] mt-4 w-3 h-3 rounded-full border-2 border-white ${
                entry.relation === '反轉' ? 'bg-red-500' : entry.relation === '新增' ? 'bg-blue-500' : 'bg-gray-300'
              }`}
            />
            <EntryCard entry={entry} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function OverviewTable({
  rows,
  buckets,
  onThread,
}: {
  rows: ThreadSummary[];
  buckets: Bucket[];
  onThread: (t: Thread) => void;
}) {
  return (
    <div className="overflow-x-auto bg-white border border-gray-200 rounded-lg">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-xs text-gray-400">
            <th className="sticky left-0 bg-white text-left font-medium px-3 py-2 min-w-[160px] border-b border-gray-200">
              主題
            </th>
            {buckets.map((b) => (
              <th key={b.key} className="font-medium px-2 py-2 border-b border-gray-200 whitespace-nowrap">
                {b.label}
                <span className="block text-[10px] font-normal">{b.sublabel}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ thread }) => (
            <tr key={thread.id} onClick={() => onThread(thread)} className="cursor-pointer hover:bg-gray-50">
              <th className="sticky left-0 bg-white text-left font-normal text-gray-700 px-3 py-2 border-b border-gray-100">
                {thread.label}
              </th>
              {buckets.map((b) => {
                const entries = thread.history.filter((h) => b.episodes.has(h.episode));
                if (!entries.length) return <td key={b.key} className="border-b border-gray-100" />;
                const rel = cellRelation(entries);
                const onlyBackground = entries.every((e) => e.focus === '背景');
                return (
                  <td
                    key={b.key}
                    title={`${rel}（${entries.length} 條）`}
                    className={`text-center text-base border-b border-gray-100 ${RELATION_COLOR[rel]} ${
                      onlyBackground ? 'opacity-40' : ''
                    }`}
                  >
                    {RELATION_SYMBOL[rel]}
                    {entries.length > 1 && <sup className="text-[9px] text-gray-400">{entries.length}</sup>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CompanyAnalysisPage() {
  const { key } = useParams<{ key: string }>();
  const dispatch = useAppDispatch();
  const { current, status, error } = useAppSelector((s) => s.analysis);
  const [tab, setTab] = useState<Tab>('changes');
  const [selected, setSelected] = useState<Thread | null>(null);
  const [openGroups, setOpenGroups] = useState<Set<ThreadGroup>>(new Set());
  const [changeLimit, setChangeLimit] = useState(20);

  useEffect(() => {
    if (key) dispatch(fetchAnalysis(decodeURIComponent(key)));
  }, [dispatch, key]);

  const data = current && current.key === decodeURIComponent(key).toUpperCase() ? current : null;
  const changes = useMemo(() => (data ? recentChanges(data.threads) : []), [data]);
  const summaries = useMemo(() => (data ? summarizeThreads(data.threads, data.episodes) : []), [data]);
  const buckets = useMemo(() => (data ? timeBuckets(data.episodes) : []), [data]);

  const showThread = (t: Thread) => {
    setSelected(t);
    window.scrollTo({ top: 0 });
  };

  if (status === 'loading' || (status === 'idle' && !data)) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-400 animate-pulse">載入中...</p>
      </div>
    );
  }

  if (status === 'failed' || !data) {
    return (
      <div className="flex flex-col items-center gap-3 h-64 justify-center px-4 text-center">
        <p className="text-red-500 text-sm">{error ?? '載入失敗'}</p>
        <button
          onClick={() => dispatch(fetchAnalysis(decodeURIComponent(key)))}
          className="px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
        >
          重試
        </button>
      </div>
    );
  }

  const toggleGroup = (g: ThreadGroup) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 pb-24 sm:pb-8">
      <Link href={`/stocks/${encodeURIComponent(data.key)}`} className="text-xs text-blue-500 hover:underline">
        ← {data.key}
      </Link>
      <h1 className="text-2xl font-bold text-gray-800 mt-2">{data.company}：跨集數論點</h1>
      <p className="text-xs text-gray-400 mt-1">
        分析範圍：{RANGE_LABEL[data.range] ?? data.range} · 實際涵蓋 {data.first_episode}–{data.last_episode}（
        {data.episode_count} 集，{formatDate(data.first_date)} 到 {formatDate(data.last_date)}） · {data.thread_count}{' '}
        個主題、{data.reason_count} 條理由 · 更新於 {data.generated_at.slice(0, 10)}
      </p>

      {selected ? (
        <div className="mt-6">
          <ThreadTimeline thread={selected} onBack={() => setSelected(null)} />
        </div>
      ) : (
        <>
          <div className="flex gap-1 mt-5 mb-4 border-b border-gray-200">
            {(
              [
                ['changes', '最近變化'],
                ['overview', '主題總覽'],
              ] as [Tab, string][]
            ).map(([t, label]) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm -mb-px border-b-2 transition ${
                  tab === t ? 'border-blue-500 text-blue-600 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'changes' && (
            <div className="space-y-2">
              <p className="text-xs text-gray-400 mb-2">只列「反轉」和 {data.key} 為主角的「新增」，新的在上面。點主題看完整時間軸。</p>
              {changes.length === 0 && <p className="text-sm text-gray-400 py-6 text-center">還沒有變化</p>}
              {changes.slice(0, changeLimit).map(({ thread, entry }, i) => (
                <EntryCard
                  key={`${thread.id}-${entry.episode}-${i}`}
                  entry={entry}
                  threadLabel={thread.label}
                  onThread={() => showThread(thread)}
                />
              ))}
              {changes.length > changeLimit && (
                <button
                  onClick={() => setChangeLimit((n) => n + 20)}
                  className="w-full py-2 text-sm text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition"
                >
                  顯示更多（還有 {changes.length - changeLimit} 條）
                </button>
              )}
            </div>
          )}

          {tab === 'overview' && (
            <div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mb-3">
                {(Object.keys(RELATION_SYMBOL) as Relation[]).map((r) => (
                  <span key={r}>
                    <span className={RELATION_COLOR[r]}>{RELATION_SYMBOL[r]}</span> {r}
                  </span>
                ))}
                <span>淡色＝只當背景提到</span>
                <span>空白＝沒提到</span>
              </div>
              <OverviewTable rows={summaries.filter((s) => s.group === 'active')} buckets={buckets} onThread={showThread} />
              {(['dormant', 'background'] as const).map((g) => {
                const rows = summaries.filter((s) => s.group === g);
                if (!rows.length) return null;
                return (
                  <div key={g} className="mt-3">
                    <button onClick={() => toggleGroup(g)} className="text-sm text-gray-500 hover:text-gray-700 mb-2">
                      {openGroups.has(g) ? '▾' : '▸'} {GROUP_LABEL[g]}（{rows.length}）
                    </button>
                    {openGroups.has(g) && <OverviewTable rows={rows} buckets={buckets} onThread={showThread} />}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
