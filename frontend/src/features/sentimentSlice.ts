import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

export interface SentimentPoint {
  episode: string;
  fullTitle: string;
  title: string;
  uploadDate: string;
  score: number;
  label: '樂觀' | '謹慎' | '悲觀';
  reason: string;
}

interface SentimentState {
  timeline: SentimentPoint[];
  status: 'idle' | 'loading' | 'succeeded' | 'failed';
  error: string | undefined;
}

const initialState: SentimentState = {
  timeline: [],
  status: 'idle',
  error: undefined,
};

export const fetchSentimentTimeline = createAsyncThunk(
  'sentiment/fetchTimeline',
  async (_, { rejectWithValue }) => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/sentiment/timeline`
      );
      if (!response.ok) {
        const err = await response.json().catch(() => null);
        throw new Error(err?.error || 'Network response was not ok');
      }
      return (await response.json()) as SentimentPoint[];
    } catch (error) {
      return rejectWithValue((error as Error).message);
    }
  }
);

const sentimentSlice = createSlice({
  name: 'sentiment',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchSentimentTimeline.pending, (state) => {
        state.status = 'loading';
        state.error = undefined;
      })
      .addCase(fetchSentimentTimeline.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.timeline = action.payload;
      })
      .addCase(fetchSentimentTimeline.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload as string;
      });
  },
});

export default sentimentSlice.reducer;
