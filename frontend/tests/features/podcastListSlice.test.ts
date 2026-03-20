import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import podcastListReducer, {
  fetchPodcasts,
  setPage,
} from '@/features/podcastListSlice';

describe('podcastListSlice', () => {
  function makeStore() {
    return configureStore({ reducer: { podcastList: podcastListReducer } });
  }

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('has correct initial state', () => {
    const store = makeStore();
    const state = store.getState().podcastList;

    expect(state).toEqual({
      podcasts: [],
      status: 'idle',
      error: undefined,
      page: 1,
      limit: 10,
    });
  });

  it('setPage synchronous action updates page', () => {
    const store = makeStore();
    store.dispatch(setPage(3));

    expect(store.getState().podcastList.page).toBe(3);
  });

  it('sets status to loading when pending', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));

    const store = makeStore();
    store.dispatch(fetchPodcasts({ page: 1, limit: 10 }));

    expect(store.getState().podcastList.status).toBe('loading');
  });

  it('populates podcasts and sets status to succeeded on fulfilled', async () => {
    const fakePodcasts = [
      {
        fullTitle: 'TestPodcaster EP001',
        title: 'EP1',
        podcaster: 'TestPodcaster',
        episode: 'EP001',
        uploadDate: '20231215',
      },
    ];
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => fakePodcasts,
    });

    const store = makeStore();
    await store.dispatch(fetchPodcasts({ page: 1, limit: 10 }));

    const state = store.getState().podcastList;
    expect(state.status).toBe('succeeded');
    expect(state.podcasts).toEqual(fakePodcasts);
  });

  it('sets status to failed on non-ok response', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Internal server error' }),
    });

    const store = makeStore();
    await store.dispatch(fetchPodcasts({ page: 1, limit: 10 }));

    const state = store.getState().podcastList;
    expect(state.status).toBe('failed');
    expect(state.error).toBeDefined();
  });
});
