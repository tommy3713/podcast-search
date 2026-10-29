import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';

const mockFetchWithAuth = vi.hoisted(() => vi.fn());

vi.mock('@/utils/fetchWithAuth', () => ({
  fetchWithAuth: mockFetchWithAuth,
}));

import analysisReducer, { fetchAnalysis, fetchAnalysisList } from '@/features/analysisSlice';

const summary = {
  key: 'NVDA',
  company: '輝達（NVIDIA / NVDA / NV）',
  range: 'all',
  generated_at: '2026-10-23T16:43:46',
  episode_count: 4,
  thread_count: 1,
  reason_count: 1,
  first_episode: 'EP461',
  last_episode: 'EP464',
  first_date: '20240612',
  last_date: '20240622',
};

const analysis = {
  ...summary,
  episodes: [{ episode: 'EP464', date: '20240622', fullTitle: '[20240622] EP464', reason_count: 1 }],
  threads: [
    {
      id: 'T1',
      label: '輝達毛利率',
      history: [
        {
          episode: 'EP464',
          date: '20240622',
          relation: '新增',
          reason: '主持人認為輝達毛利率會被慢慢侵蝕。',
          reference: '輝達的毛利會慢慢被侵蝕',
          focus: '主角',
        },
      ],
    },
  ],
};

describe('analysisSlice', () => {
  function makeStore() {
    return configureStore({ reducer: { analysis: analysisReducer } });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('has correct initial state', () => {
    expect(makeStore().getState().analysis).toEqual({
      list: [],
      listStatus: 'idle',
      current: null,
      status: 'idle',
      error: undefined,
    });
  });

  it('fetchAnalysisList fulfilled stores the list without auth', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [summary] });
    vi.stubGlobal('fetch', mockFetch);
    const store = makeStore();

    await store.dispatch(fetchAnalysisList());

    const state = store.getState().analysis;
    expect(state.listStatus).toBe('succeeded');
    expect(state.list).toEqual([summary]);
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/api/analysis');
    expect(mockFetchWithAuth).not.toHaveBeenCalled();
  });

  it('fetchAnalysisList rejected sets listStatus to failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'boom' }) }));
    const store = makeStore();

    await store.dispatch(fetchAnalysisList());

    expect(store.getState().analysis.listStatus).toBe('failed');
  });

  it('fetchAnalysis fulfilled stores the analysis', async () => {
    mockFetchWithAuth.mockResolvedValue({ ok: true, status: 200, json: async () => analysis });
    const store = makeStore();

    await store.dispatch(fetchAnalysis('NVDA'));

    const state = store.getState().analysis;
    expect(state.status).toBe('succeeded');
    expect(state.current).toEqual(analysis);
    expect(mockFetchWithAuth).toHaveBeenCalledWith('http://localhost:3000/api/analysis/NVDA');
  });

  it('fetchAnalysis 404 explains the company was never analyzed', async () => {
    mockFetchWithAuth.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'Analysis not found' }) });
    const store = makeStore();

    await store.dispatch(fetchAnalysis('TSM'));

    const state = store.getState().analysis;
    expect(state.status).toBe('failed');
    expect(state.current).toBeNull();
    expect(state.error).toBe('這家公司還沒有做過跨集數分析');
  });

  it('fetchAnalysis rejected when not logged in', async () => {
    mockFetchWithAuth.mockRejectedValue(new Error('尚未登入'));
    const store = makeStore();

    await store.dispatch(fetchAnalysis('NVDA'));

    expect(store.getState().analysis.status).toBe('failed');
    expect(store.getState().analysis.error).toBe('尚未登入');
  });
});
