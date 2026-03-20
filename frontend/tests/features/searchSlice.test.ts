import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import searchReducer, { fetchSearchResults } from '@/features/searchSlice';

describe('searchSlice', () => {
  function makeStore() {
    return configureStore({ reducer: { search: searchReducer } });
  }

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('has correct initial state', () => {
    const store = makeStore();
    const state = store.getState().search;

    expect(state).toEqual({
      results: [],
      status: 'idle',
      error: undefined,
    });
  });

  it('sets status to loading when pending', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));

    const store = makeStore();
    store.dispatch(fetchSearchResults('test'));

    expect(store.getState().search.status).toBe('loading');
  });

  it('populates results and sets status to succeeded on fulfilled', async () => {
    const fakeResults = [
      {
        podcaster: 'TestPodcaster',
        title: 'EP1',
        uploadDate: '20231215',
        episode: 'EP001',
        fullTitle: 'TestPodcaster EP001',
        highlights: ['found here'],
      },
    ];
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => fakeResults,
    });

    const store = makeStore();
    await store.dispatch(fetchSearchResults('test'));

    const state = store.getState().search;
    expect(state.status).toBe('succeeded');
    expect(state.results).toEqual(fakeResults);
  });

  it('sets status to failed on non-ok response', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
    });

    const store = makeStore();
    await store.dispatch(fetchSearchResults('test'));

    const state = store.getState().search;
    expect(state.status).toBe('failed');
    expect(state.error).toBeDefined();
  });

  it('URL-encodes the keyword in the fetch call', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    const store = makeStore();
    await store.dispatch(fetchSearchResults('hello world'));

    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('hello%20world');
  });
});
