import { describe, it, expect } from 'vitest';
import type { AnalysisEpisode, Thread, ThreadEntry } from '@/features/analysisSlice';
import { cellRelation, recentChanges, summarizeThreads, timeBuckets } from '@/utils/analysis';

function entry(episode: string, date: string, relation: ThreadEntry['relation'], focus: ThreadEntry['focus'] = '主角'): ThreadEntry {
  return { episode, date, relation, focus, reason: `${episode} ${relation}`, reference: '' };
}

function episodes(...eps: [string, string, number][]): AnalysisEpisode[] {
  return eps.map(([episode, date, reason_count]) => ({ episode, date, fullTitle: episode, reason_count }));
}

describe('cellRelation', () => {
  it('prefers 反轉 over 新增 over 更新 over 重複', () => {
    expect(cellRelation([entry('EP1', '1', '重複'), entry('EP1', '1', '更新')])).toBe('更新');
    expect(cellRelation([entry('EP1', '1', '更新'), entry('EP1', '1', '反轉'), entry('EP1', '1', '新增')])).toBe('反轉');
  });
});

describe('recentChanges', () => {
  it('keeps reversals and on-topic new threads, newest first', () => {
    const threads: Thread[] = [
      { id: 'T1', label: '毛利率', history: [entry('EP1', '20240101', '新增'), entry('EP3', '20240301', '反轉')] },
      { id: 'T2', label: '散熱廠', history: [entry('EP2', '20240201', '新增', '背景')] },
      { id: 'T3', label: '持股', history: [entry('EP2', '20240201', '新增'), entry('EP3', '20240301', '更新')] },
    ];

    const changes = recentChanges(threads).map((c) => `${c.thread.id}:${c.entry.episode}:${c.entry.relation}`);

    expect(changes).toEqual(['T1:EP3:反轉', 'T3:EP2:新增', 'T1:EP1:新增']);
  });
});

describe('summarizeThreads', () => {
  const eps = episodes(
    ['EP1', '20240101', 2],
    ['EP2', '20240201', 1],
    ['EP3', '20240301', 0],
    ['EP4', '20240401', 1],
    ['EP5', '20240501', 1]
  );

  it('marks a thread dormant when the last 3 speaking episodes skip it', () => {
    const threads: Thread[] = [
      { id: 'old', label: 'old', history: [entry('EP1', '20240101', '新增')] },
      { id: 'live', label: 'live', history: [entry('EP2', '20240201', '新增')] },
    ];

    const groups = Object.fromEntries(summarizeThreads(threads, eps).map((s) => [s.thread.id, s.group]));

    // EP3 said nothing, so the last 3 speaking episodes are EP2, EP4, EP5
    expect(groups).toEqual({ old: 'dormant', live: 'active' });
  });

  it('puts background-only threads in their own group and sorts by last mention', () => {
    const threads: Thread[] = [
      { id: 'bg', label: 'bg', history: [entry('EP5', '20240501', '新增', '背景')] },
      { id: 'a', label: 'a', history: [entry('EP1', '20240101', '新增'), entry('EP4', '20240401', '更新')] },
    ];

    const summaries = summarizeThreads(threads, eps);

    expect(summaries.map((s) => [s.thread.id, s.group, s.episodeCount])).toEqual([
      ['bg', 'background', 1],
      ['a', 'active', 2],
    ]);
  });
});

describe('timeBuckets', () => {
  it('uses one column per episode for short ranges', () => {
    const buckets = timeBuckets(episodes(['EP1', '20240101', 1], ['EP2', '20240105', 1]));

    expect(buckets.map((b) => b.label)).toEqual(['EP1', 'EP2']);
  });

  it('groups by month beyond 12 episodes', () => {
    const many = episodes(
      ...Array.from({ length: 13 }, (_, i): [string, string, number] => [`EP${i}`, i < 7 ? '20240110' : '20240210', 1])
    );

    const buckets = timeBuckets(many);

    expect(buckets.map((b) => [b.key, b.episodes.size, b.sublabel])).toEqual([
      ['2024-01', 7, '7 集'],
      ['2024-02', 6, '6 集'],
    ]);
  });
});
