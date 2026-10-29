import type { AnalysisEpisode, Relation, Thread, ThreadEntry } from '@/features/analysisSlice';

// When one cell holds several reasons, show the most informative relation
const PRIORITY: Relation[] = ['反轉', '新增', '更新', '重複'];

export const RELATION_SYMBOL: Record<Relation, string> = {
  新增: '●',
  更新: '◐',
  反轉: '⇄',
  重複: '·',
};

export const RANGE_LABEL: Record<string, string> = {
  '6m': '近六個月',
  '1y': '近一年',
  all: '全部集數',
};

// Up to this many episodes, the overview gets one column per episode; beyond it, one per month
const MAX_EPISODE_COLUMNS = 12;

export function cellRelation(entries: ThreadEntry[]): Relation {
  return entries.map((e) => e.relation).sort((a, b) => PRIORITY.indexOf(a) - PRIORITY.indexOf(b))[0];
}

export interface RecentChange {
  thread: Thread;
  entry: ThreadEntry;
}

/** Reversals and new on-topic threads, newest first: what changed lately. */
export function recentChanges(threads: Thread[]): RecentChange[] {
  return threads
    .flatMap((thread) =>
      thread.history
        .filter((e) => e.relation === '反轉' || (e.relation === '新增' && e.focus === '主角'))
        .map((entry) => ({ thread, entry }))
    )
    .sort((a, b) => b.entry.date.localeCompare(a.entry.date));
}

export type ThreadGroup = 'active' | 'dormant' | 'background';

export interface ThreadSummary {
  thread: Thread;
  lastDate: string;
  episodeCount: number;
  group: ThreadGroup;
}

/**
 * Sort threads by last mention and split them into groups. A thread is dormant when none of
 * the last `dormantAfter` episodes that said anything about the company mentions it — not being
 * mentioned is not the same as being dropped, so dormant threads are collapsed, not removed.
 */
export function summarizeThreads(
  threads: Thread[],
  episodes: AnalysisEpisode[],
  dormantAfter = 3
): ThreadSummary[] {
  const speaking = episodes.filter((e) => e.reason_count > 0).map((e) => e.episode);
  const recent = new Set(speaking.slice(-dormantAfter));
  return threads
    .map((thread) => {
      const eps = new Set(thread.history.map((h) => h.episode));
      const group: ThreadGroup = thread.history.every((h) => h.focus === '背景')
        ? 'background'
        : Array.from(eps).some((e) => recent.has(e))
          ? 'active'
          : 'dormant';
      return {
        thread,
        lastDate: thread.history.reduce((d, h) => (h.date > d ? h.date : d), ''),
        episodeCount: eps.size,
        group,
      };
    })
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate));
}

export interface Bucket {
  key: string;
  label: string;
  sublabel: string;
  episodes: Set<string>;
}

/** Overview columns: one per episode for short ranges, one per month otherwise. */
export function timeBuckets(episodes: AnalysisEpisode[]): Bucket[] {
  if (episodes.length <= MAX_EPISODE_COLUMNS) {
    return episodes.map((e) => ({
      key: e.episode,
      label: e.episode,
      sublabel: formatDate(e.date),
      episodes: new Set([e.episode]),
    }));
  }
  const byMonth = new Map<string, Bucket>();
  for (const e of episodes) {
    const month = `${e.date.slice(0, 4)}-${e.date.slice(4, 6)}`;
    if (!byMonth.has(month)) {
      byMonth.set(month, { key: month, label: month.slice(2), sublabel: '', episodes: new Set() });
    }
    byMonth.get(month)!.episodes.add(e.episode);
  }
  return Array.from(byMonth.values()).map((b) => ({ ...b, sublabel: `${b.episodes.size} 集` }));
}

export function formatDate(d: string | null | undefined): string {
  if (!d || d.length < 8) return d ?? '';
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

export function episodeNumber(episode: string): string {
  return episode.replace(/^EP/, '');
}
