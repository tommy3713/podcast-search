import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

interface Podcast {
  fullTitle: string;
  title: string;
  podcaster: string;
  episode: string;
  uploadDate: string;
}

interface PodcastListState {
  podcasts: Podcast[];
  status: 'idle' | 'loading' | 'succeeded' | 'failed';
  error: string | undefined;
  page: number;
  limit: number;
}

// Initial state
const initialState: PodcastListState = {
  podcasts: [],
  status: 'idle',
  error: undefined,
  page: 1,
  limit: 10,
};

// Async thunk to fetch podcasts
export const fetchPodcasts = createAsyncThunk(
  'podcastList/fetchPodcasts',
  async (
    { page, limit }: { page: number; limit: number },
    { rejectWithValue }
  ) => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/podcast/all?page=${page}&limit=${limit}`
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => null); // Safely parse JSON
        throw new Error(errorData?.error || 'Network response was not ok');
      }
      const data: Podcast[] = await response.json();
      return data;
    } catch (error) {
      return rejectWithValue((error as Error).message);
    }
  }
);

// Slice definition
const podcastListSlice = createSlice({
  name: 'podcastList',
  initialState,
  reducers: {
    setPage(state, action) {
      state.page = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchPodcasts.pending, (state) => {
        state.status = 'loading';
        state.error = undefined;
      })
      .addCase(fetchPodcasts.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.podcasts = action.payload;
      })
      .addCase(fetchPodcasts.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload as string;
      });
  },
});

export const { setPage } = podcastListSlice.actions;
export default podcastListSlice.reducer;
