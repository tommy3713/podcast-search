import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

export interface Occurrence {
  episode: string;
  fullTitle: string;
  title: string;
  uploadDate: string;
  quote: string;
}

export interface GlossaryTerm {
  term: string;
  count: number;
  occurrences: Occurrence[];
}

interface GlossaryState {
  terms: GlossaryTerm[];
  status: 'idle' | 'loading' | 'succeeded' | 'failed';
  error: string | undefined;
}

const initialState: GlossaryState = {
  terms: [],
  status: 'idle',
  error: undefined,
};

export const fetchGlossary = createAsyncThunk(
  'glossary/fetchGlossary',
  async (_, { rejectWithValue }) => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/glossary`
      );
      if (!response.ok) {
        const err = await response.json().catch(() => null);
        throw new Error(err?.error || 'Network response was not ok');
      }
      return (await response.json()) as GlossaryTerm[];
    } catch (error) {
      return rejectWithValue((error as Error).message);
    }
  }
);

const glossarySlice = createSlice({
  name: 'glossary',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchGlossary.pending, (state) => {
        state.status = 'loading';
        state.error = undefined;
      })
      .addCase(fetchGlossary.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.terms = action.payload;
      })
      .addCase(fetchGlossary.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload as string;
      });
  },
});

export default glossarySlice.reducer;
