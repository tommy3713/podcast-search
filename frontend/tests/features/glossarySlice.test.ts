import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';

import glossaryReducer, {
  fetchGlossary,
  GlossaryTerm,
} from '@/features/glossarySlice';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('glossarySlice', () => {
  function makeStore() {
    return configureStore({ reducer: { glossary: glossaryReducer } });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has correct initial state', () => {
    const store = makeStore();
    const state = store.getState().glossary;
    expect(state).toEqual({
      terms: [],
      status: 'idle',
      error: undefined,
    });
  });

  it('fetchGlossary fulfilled populates terms and sets status to succeeded', async () => {
    const fakeTerms: GlossaryTerm[] = [
      {
        term: 'EPS 修正',
        count: 3,
        occurrences: [
          {
            episode: '461',
            fullTitle: '[20240612] EP461 Test',
            title: 'Test Episode',
            uploadDate: '20240612',
            quote: '主持人提到 EPS 修正',
          },
        ],
      },
    ];
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => fakeTerms,
    });

    const store = makeStore();
    await store.dispatch(fetchGlossary());

    const state = store.getState().glossary;
    expect(state.status).toBe('succeeded');
    expect(state.terms).toEqual(fakeTerms);
    expect(state.error).toBeUndefined();
  });

  it('fetchGlossary sets status to loading while pending', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));

    const store = makeStore();
    store.dispatch(fetchGlossary());

    const state = store.getState().glossary;
    expect(state.status).toBe('loading');
  });

  it('fetchGlossary rejected when fetch fails', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Internal server error' }),
    });

    const store = makeStore();
    await store.dispatch(fetchGlossary());

    const state = store.getState().glossary;
    expect(state.status).toBe('failed');
    expect(state.error).toBeDefined();
  });

  it('fetchGlossary rejected when network throws', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const store = makeStore();
    await store.dispatch(fetchGlossary());

    const state = store.getState().glossary;
    expect(state.status).toBe('failed');
    expect(state.error).toBe('Network error');
  });

  it('fetchGlossary handles empty array response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    const store = makeStore();
    await store.dispatch(fetchGlossary());

    const state = store.getState().glossary;
    expect(state.status).toBe('succeeded');
    expect(state.terms).toEqual([]);
  });
});
