import { RootState } from '@/app/store';
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
  error?: string;
  transcriptStatus: 'idle' | 'loading' | 'succeeded' | 'failed';
  transcriptError?: string;
  transcript: string | null;
}

// Initial state
const initialState: SummaryState = {
  result: null,
  status: 'idle',
  error: undefined,
  transcriptStatus: 'idle',
  transcriptError: undefined,
  transcript: null,
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
        const errorData = await response.json().catch(() => null); // Safely parse JSON
        throw new Error(errorData?.error || 'Network response was not ok');
      }
      const data: SummaryResult = await response.json();
      return data;
    } catch (error) {
      return rejectWithValue((error as Error).message);
    }
  }
);

export const fetchTranscript = createAsyncThunk<
  { content: string },
  { podcaster: string; episode: string },
  { state: RootState; rejectValue: string }
>(
  'summary/fetchTranscript',
  async ({ podcaster, episode }, { rejectWithValue }) => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/podcast/transcript?podcaster=${podcaster}&episode=${episode}`
      );
      if (!res.ok)
        throw new Error((await res.text()) || 'Fetch transcript failed');
      const data = await res.json();

      return { content: data.content as string };
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
    // fetchSummary
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
      .addCase(fetchTranscript.pending, (state, { meta }) => {
        state.transcriptStatus = 'loading';
        state.transcriptError = undefined;
      })
      .addCase(fetchTranscript.fulfilled, (state, { payload, meta }) => {
        state.transcriptStatus = 'succeeded';
        state.transcript = payload.content;
      })
      .addCase(fetchTranscript.rejected, (state, { payload, meta }) => {
        state.transcriptStatus = 'failed';
        state.transcriptError = payload as string;
      });
  },
});

export default summarySlice.reducer;
