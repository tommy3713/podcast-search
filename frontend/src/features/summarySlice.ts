import { RootState } from '@/app/store';
import { fetchWithAuth } from '@/utils/fetchWithAuth';
import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

interface SummaryResult {
  _id: string;
  title: string;
  uploadDate: string;
  episode: string;
  fullTitle: string;
  podcaster: string;
  note: string;
}

interface Chunk {
  chunk_index: number;
  chunk_text: string;
}

interface SummaryState {
  result: SummaryResult | null;
  status: 'idle' | 'loading' | 'succeeded' | 'failed';
  error?: string;
  chunksStatus: 'idle' | 'loading' | 'succeeded' | 'failed';
  chunksError?: string;
  chunks: Chunk[];
  chunksPage: number;
  chunksTotal: number;
  chunksHasMore: boolean;
}

const initialState: SummaryState = {
  result: null,
  status: 'idle',
  error: undefined,
  chunksStatus: 'idle',
  chunksError: undefined,
  chunks: [],
  chunksPage: 0,
  chunksTotal: 0,
  chunksHasMore: false,
};

export const fetchSummary = createAsyncThunk(
  'summary/fetchSummary',
  async (
    { podcaster, episode }: { podcaster: string; episode: string },
    { rejectWithValue }
  ) => {
    try {
      const response = await fetchWithAuth(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/podcast/summary?podcaster=${podcaster}&episode=${episode}`
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || 'Network response was not ok');
      }
      const data: SummaryResult = await response.json();
      return data;
    } catch (error) {
      return rejectWithValue((error as Error).message);
    }
  }
);

export const fetchChunks = createAsyncThunk<
  { chunks: Chunk[]; total: number; page: number; hasMore: boolean },
  { podcaster: string; episode: string },
  { state: RootState; rejectValue: string }
>(
  'summary/fetchChunks',
  async ({ podcaster, episode }, { rejectWithValue }) => {
    try {
      const res = await fetchWithAuth(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/podcast/chunks?podcaster=${podcaster}&episode=${episode}&page=1`
      );
      if (!res.ok) throw new Error((await res.text()) || 'Fetch chunks failed');
      return await res.json();
    } catch (err) {
      return rejectWithValue((err as Error).message);
    }
  }
);

export const loadMoreChunks = createAsyncThunk<
  { chunks: Chunk[]; total: number; page: number; hasMore: boolean },
  { podcaster: string; episode: string },
  { state: RootState; rejectValue: string }
>(
  'summary/loadMoreChunks',
  async ({ podcaster, episode }, { getState, rejectWithValue }) => {
    const nextPage = getState().summary.chunksPage + 1;
    try {
      const res = await fetchWithAuth(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/podcast/chunks?podcaster=${podcaster}&episode=${episode}&page=${nextPage}`
      );
      if (!res.ok) throw new Error((await res.text()) || 'Load more chunks failed');
      return await res.json();
    } catch (err) {
      return rejectWithValue((err as Error).message);
    }
  }
);

const summarySlice = createSlice({
  name: 'summary',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchSummary.pending, (state) => {
        state.status = 'loading';
        state.error = undefined;
      })
      .addCase(fetchSummary.fulfilled, (state, { payload }) => {
        state.status = 'succeeded';
        state.result = payload;
      })
      .addCase(fetchSummary.rejected, (state, { payload }) => {
        state.status = 'failed';
        state.error = payload as string;
      })
      .addCase(fetchChunks.pending, (state) => {
        state.chunksStatus = 'loading';
        state.chunksError = undefined;
        state.chunks = [];
        state.chunksPage = 0;
        state.chunksTotal = 0;
        state.chunksHasMore = false;
      })
      .addCase(fetchChunks.fulfilled, (state, { payload }) => {
        state.chunksStatus = 'succeeded';
        state.chunks = payload.chunks;
        state.chunksPage = payload.page;
        state.chunksTotal = payload.total;
        state.chunksHasMore = payload.hasMore;
      })
      .addCase(fetchChunks.rejected, (state, { payload }) => {
        state.chunksStatus = 'failed';
        state.chunksError = payload as string;
      })
      .addCase(loadMoreChunks.pending, (state) => {
        state.chunksStatus = 'loading';
      })
      .addCase(loadMoreChunks.fulfilled, (state, { payload }) => {
        state.chunksStatus = 'succeeded';
        state.chunks = [...state.chunks, ...payload.chunks];
        state.chunksPage = payload.page;
        state.chunksTotal = payload.total;
        state.chunksHasMore = payload.hasMore;
      })
      .addCase(loadMoreChunks.rejected, (state, { payload }) => {
        state.chunksStatus = 'failed';
        state.chunksError = payload as string;
      });
  },
});

export default summarySlice.reducer;
