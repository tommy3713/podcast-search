// src/features/searchSlice.ts
import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import dotenv from 'dotenv';

dotenv.config();

export interface Result {
  podcaster: string;
  title: string;
  uploadDate: string;
  episode: string;
  fullTitle: string;
  highlights: Array<string>;
}

type SearchResults = Array<Result>;

// Creating the async thunk
export const fetchSearchResults = createAsyncThunk(
  'search/fetchSearchResults',
  async (keyword: string, { rejectWithValue }) => {
    try {
      const response = await fetch(
        `${
          process.env.NEXT_PUBLIC_BACKEND_URL
        }/api/search?keyword=${encodeURIComponent(keyword)}`
      );
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      const data: SearchResults = await response.json();
      console.log(data);
      return data;
    } catch (error) {
      return rejectWithValue((error as Error).message);
    }
  }
);

// src/features/searchSlice.ts continued

// Initial state type
interface SearchState {
  results: SearchResults;
  status: 'idle' | 'loading' | 'succeeded' | 'failed';
  error: string | undefined;
}

// Initial state
const initialState: SearchState = {
  results: [],
  status: 'idle',
  error: undefined,
};

// Slice definition
const searchSlice = createSlice({
  name: 'search',
  initialState,
  reducers: {
    // You can add reducers here for other synchronous actions if necessary
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchSearchResults.pending, (state) => {
        state.status = 'loading';
        state.error = undefined;
      })
      .addCase(fetchSearchResults.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.results = action.payload; // Make sure the payload matches what you expect
      })
      .addCase(fetchSearchResults.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload as string; // Casting because we use rejectWithValue
      });
  },
});

export default searchSlice.reducer;
