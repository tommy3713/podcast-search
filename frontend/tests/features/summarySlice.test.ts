import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';

const mockFetchWithAuth = vi.hoisted(() => vi.fn());

vi.mock('@/utils/fetchWithAuth', () => ({
  fetchWithAuth: mockFetchWithAuth,
}));

import summaryReducer, {
  fetchSummary,
  fetchChunks,
  loadMoreChunks,
  fetchTranscript,
} from '@/features/summarySlice';

describe('summarySlice', () => {
  function makeStore() {
    return configureStore({ reducer: { summary: summaryReducer } });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has correct initial state', () => {
    const store = makeStore();
    const state = store.getState().summary;

    expect(state).toEqual({
      result: null,
      status: 'idle',
      error: undefined,
      chunksStatus: 'idle',
      chunksError: undefined,
      chunks: [],
      chunksPage: 0,
      chunksTotal: 0,
      chunksHasMore: false,
      transcript: null,
      transcriptSegments: null,
      transcriptStatus: 'idle',
      transcriptError: undefined,
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

  it('fetchChunks fulfilled sets chunksStatus and populates chunks', async () => {
    const fakeChunksResponse = {
      chunks: [
        { chunk_index: 0, chunk_text: 'First chunk' },
        { chunk_index: 1, chunk_text: 'Second chunk' },
      ],
      total: 15,
      page: 1,
      hasMore: true,
    };
    mockFetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => fakeChunksResponse,
    });

    const store = makeStore();
    await store.dispatch(fetchChunks({ podcaster: 'TestPodcaster', episode: 'EP001' }));

    const state = store.getState().summary;
    expect(state.chunksStatus).toBe('succeeded');
    expect(state.chunks).toEqual(fakeChunksResponse.chunks);
    expect(state.chunksPage).toBe(1);
    expect(state.chunksTotal).toBe(15);
    expect(state.chunksHasMore).toBe(true);
  });

  it('fetchChunks rejected sets chunksStatus to failed', async () => {
    mockFetchWithAuth.mockResolvedValue({
      ok: false,
      text: async () => 'Fetch chunks failed',
    });

    const store = makeStore();
    await store.dispatch(fetchChunks({ podcaster: 'TestPodcaster', episode: 'EP001' }));

    const state = store.getState().summary;
    expect(state.chunksStatus).toBe('failed');
    expect(state.chunksError).toBeDefined();
  });

  it('loadMoreChunks appends chunks to existing list', async () => {
    const page1 = {
      chunks: [{ chunk_index: 0, chunk_text: 'First' }],
      total: 20,
      page: 1,
      hasMore: true,
    };
    const page2 = {
      chunks: [{ chunk_index: 1, chunk_text: 'Second' }],
      total: 20,
      page: 2,
      hasMore: false,
    };
    mockFetchWithAuth
      .mockResolvedValueOnce({ ok: true, json: async () => page1 })
      .mockResolvedValueOnce({ ok: true, json: async () => page2 });

    const store = makeStore();
    await store.dispatch(fetchChunks({ podcaster: 'TestPodcaster', episode: 'EP001' }));
    await store.dispatch(loadMoreChunks({ podcaster: 'TestPodcaster', episode: 'EP001' }));

    const state = store.getState().summary;
    expect(state.chunks).toHaveLength(2);
    expect(state.chunksPage).toBe(2);
    expect(state.chunksHasMore).toBe(false);
  });

  it('fetchTranscript fulfilled stores content and segments', async () => {
    const fakeTranscript = {
      content: '歡迎收聽股癌。',
      segments: [{ start: 0, end: 2.5, text: '歡迎收聽股癌。' }],
    };
    mockFetchWithAuth.mockResolvedValue({ ok: true, json: async () => fakeTranscript });

    const store = makeStore();
    await store.dispatch(fetchTranscript({ podcaster: 'TestPodcaster', episode: 'EP001' }));

    const state = store.getState().summary;
    expect(state.transcriptStatus).toBe('succeeded');
    expect(state.transcript).toBe('歡迎收聽股癌。');
    expect(state.transcriptSegments).toEqual(fakeTranscript.segments);
  });

  it('fetchTranscript sets segments to null when the response has none', async () => {
    mockFetchWithAuth.mockResolvedValue({ ok: true, json: async () => ({ content: '舊的逐字稿' }) });

    const store = makeStore();
    await store.dispatch(fetchTranscript({ podcaster: 'TestPodcaster', episode: 'EP001' }));

    const state = store.getState().summary;
    expect(state.transcript).toBe('舊的逐字稿');
    expect(state.transcriptSegments).toBeNull();
  });

  it('fetchTranscript rejected sets transcriptStatus to failed', async () => {
    mockFetchWithAuth.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Transcript not found' }),
    });

    const store = makeStore();
    await store.dispatch(fetchTranscript({ podcaster: 'TestPodcaster', episode: 'EP001' }));

    const state = store.getState().summary;
    expect(state.transcriptStatus).toBe('failed');
    expect(state.transcriptError).toBe('Transcript not found');
  });

  it('summary success and chunks failure coexist independently', async () => {
    const fakeSummary = {
      _id: 'abc',
      title: 'EP1',
      uploadDate: '20231215',
      episode: 'EP001',
      fullTitle: 'TestPodcaster EP001',
      podcaster: 'TestPodcaster',
      note: 'A note',
    };
    mockFetchWithAuth
      .mockResolvedValueOnce({ ok: true, json: async () => fakeSummary })
      .mockResolvedValueOnce({ ok: false, text: async () => 'Chunks error' });

    const store = makeStore();
    await store.dispatch(fetchSummary({ podcaster: 'TestPodcaster', episode: 'EP001' }));
    await store.dispatch(fetchChunks({ podcaster: 'TestPodcaster', episode: 'EP001' }));

    const state = store.getState().summary;
    expect(state.status).toBe('succeeded');
    expect(state.result).toEqual(fakeSummary);
    expect(state.chunksStatus).toBe('failed');
  });
});
