import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

export const THEMES = [
  '美股與科技股',
  '台灣市場',
  '總體經濟',
  '中國與新興市場',
  '投資心理與哲學',
  '能源與原物料',
  '債券與利率',
  '加密貨幣',
  '房地產',
] as const;

export type Theme = (typeof THEMES)[number];

export interface ThemeEpisode {
  episode: string;
  fullTitle: string;
  title: string;
  uploadDate: string;
  themes: Theme[];
}

interface ThemesState {
  // timeline[month][theme] = episode count
  timeline: Record<string, Record<string, number>>;
  episodes: ThemeEpisode[];
  status: 'idle' | 'loading' | 'succeeded' | 'failed';
  error: string | undefined;
}

const initialState: ThemesState = {
  timeline: {},
  episodes: [],
  status: 'idle',
  error: undefined,
};

export const fetchThemesTimeline = createAsyncThunk(
  'themes/fetchTimeline',
  async (_, { rejectWithValue }) => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/themes/timeline`
      );
      if (!response.ok) {
        const err = await response.json().catch(() => null);
        throw new Error(err?.error || 'Network response was not ok');
      }
      return await response.json();
    } catch (error) {
      return rejectWithValue((error as Error).message);
    }
  }
);

const themesSlice = createSlice({
  name: 'themes',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchThemesTimeline.pending, (state) => {
        state.status = 'loading';
        state.error = undefined;
      })
      .addCase(fetchThemesTimeline.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.timeline = action.payload.timeline;
        state.episodes = action.payload.episodes;
      })
      .addCase(fetchThemesTimeline.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload as string;
      });
  },
});

export default themesSlice.reducer;
