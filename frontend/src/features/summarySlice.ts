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

interface SummaryState {
  result: SummaryResult | null;
  status: 'idle' | 'loading' | 'succeeded' | 'failed';
  error: string | undefined;
}

// Initial state
const initialState: SummaryState = {
  result: null,
  status: 'idle',
  error: undefined,
};

// Async thunk to fetch the summary
export const fetchSummary = createAsyncThunk(
  'summary/fetchSummary',
  async (
    { podcaster, episode }: { podcaster: string; episode: string },
    { rejectWithValue }
  ) => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/podcast/summary?podcaster=${podcaster}&episode=${episode}`
      );
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      const data: SummaryResult = await response.json();
      return data;
    } catch (error) {
      return rejectWithValue((error as Error).message);
    }
  }
);

// Slice definition
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
      .addCase(fetchSummary.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.result = action.payload;
      })
      .addCase(fetchSummary.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload as string;
      });
  },
});

export default summarySlice.reducer;
