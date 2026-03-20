import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';

const mockFetchWithAuth = vi.hoisted(() => vi.fn());

vi.mock('@/utlis/fetchWithAuth', () => ({
  fetchWithAuth: mockFetchWithAuth,
}));

import summaryReducer, {
  fetchSummary,
  fetchTranscript,
} from '@/features/summarySlice';

describe('summarySlice', () => {
  function makeStore() {
    return configureStore({ reducer: { summary: summaryReducer } });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('has correct initial state', () => {
    const store = makeStore();
    const state = store.getState().summary;

    expect(state).toEqual({
      result: null,
      status: 'idle',
      error: undefined,
      transcriptStatus: 'idle',
      transcriptError: undefined,
      transcript: null,
    });
  });

  it('fetchSummary fulfilled sets status to succeeded and populates result', async () => {
    const fakeSummary = {
      _id: 'abc',
      title: 'EP1',
      uploadDate: '20231215',
      episode: 'EP001',
      fullTitle: 'TestPodcaster EP001',
      podcaster: 'TestPodcaster',
      note: '- Point one\n- Point two',
    };
    mockFetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => fakeSummary,
    });

    const store = makeStore();
    await store.dispatch(fetchSummary({ podcaster: 'TestPodcaster', episode: 'EP001' }));

    const state = store.getState().summary;
    expect(state.status).toBe('succeeded');
    expect(state.result).toEqual(fakeSummary);
  });

  it('fetchSummary rejected when fetchWithAuth throws 尚未登入', async () => {
    mockFetchWithAuth.mockRejectedValue(new Error('尚未登入'));

    const store = makeStore();
    await store.dispatch(fetchSummary({ podcaster: 'TestPodcaster', episode: 'EP001' }));

    const state = store.getState().summary;
    expect(state.status).toBe('failed');
    expect(state.error).toBe('尚未登入');
  });

  it('fetchTranscript fulfilled sets transcriptStatus and transcript', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ content: 'Full transcript here' }),
    });

    const store = makeStore();
    await store.dispatch(fetchTranscript({ podcaster: 'TestPodcaster', episode: 'EP001' }));

    const state = store.getState().summary;
    expect(state.transcriptStatus).toBe('succeeded');
    expect(state.transcript).toBe('Full transcript here');
  });

  it('fetchTranscript rejected sets transcriptStatus to failed', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      text: async () => 'Fetch transcript failed',
    });

    const store = makeStore();
    await store.dispatch(fetchTranscript({ podcaster: 'TestPodcaster', episode: 'EP001' }));

    const state = store.getState().summary;
    expect(state.transcriptStatus).toBe('failed');
    expect(state.transcriptError).toBeDefined();
  });

  it('summary success and transcript failure coexist independently', async () => {
    const fakeSummary = {
      _id: 'abc',
      title: 'EP1',
      uploadDate: '20231215',
      episode: 'EP001',
      fullTitle: 'TestPodcaster EP001',
      podcaster: 'TestPodcaster',
      note: 'A note',
    };
    mockFetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => fakeSummary,
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      text: async () => 'Transcript error',
    });

    const store = makeStore();
    await store.dispatch(fetchSummary({ podcaster: 'TestPodcaster', episode: 'EP001' }));
    await store.dispatch(fetchTranscript({ podcaster: 'TestPodcaster', episode: 'EP001' }));

    const state = store.getState().summary;
    expect(state.status).toBe('succeeded');
    expect(state.result).toEqual(fakeSummary);
    expect(state.transcriptStatus).toBe('failed');
  });
});
