import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

export interface StockSummary {
  ticker: string;
  count: number;
  firstDate: string;
  lastDate: string;
}

export interface StockEpisode {
  episode: string;
  fullTitle: string;
  title: string;
  uploadDate: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
}

export interface StockDetail {
  ticker: string;
  episodes: StockEpisode[];
  sentimentCounts: { bullish: number; bearish: number; neutral: number };
}

interface StocksState {
  list: StockSummary[];
  listStatus: 'idle' | 'loading' | 'succeeded' | 'failed';
  detail: StockDetail | null;
  detailStatus: 'idle' | 'loading' | 'succeeded' | 'failed';
}

const initialState: StocksState = {
  list: [],
  listStatus: 'idle',
  detail: null,
  detailStatus: 'idle',
};

export const fetchStocksList = createAsyncThunk(
  'stocks/fetchList',
  async (_, { rejectWithValue }) => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/stocks`);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Failed');
      return await res.json() as StockSummary[];
    } catch (e) {
      return rejectWithValue((e as Error).message);
    }
  }
);

export const fetchStockDetail = createAsyncThunk(
  'stocks/fetchDetail',
  async (ticker: string, { rejectWithValue }) => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/stocks/${encodeURIComponent(ticker)}`);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Failed');
      return await res.json() as StockDetail;
    } catch (e) {
      return rejectWithValue((e as Error).message);
    }
  }
);

const stocksSlice = createSlice({
  name: 'stocks',
  initialState,
  reducers: {
    clearDetail(state) {
      state.detail = null;
      state.detailStatus = 'idle';
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchStocksList.pending, (state) => { state.listStatus = 'loading'; })
      .addCase(fetchStocksList.fulfilled, (state, action) => {
        state.listStatus = 'succeeded';
        state.list = action.payload;
      })
      .addCase(fetchStocksList.rejected, (state) => { state.listStatus = 'failed'; })
      .addCase(fetchStockDetail.pending, (state) => { state.detailStatus = 'loading'; state.detail = null; })
      .addCase(fetchStockDetail.fulfilled, (state, action) => {
        state.detailStatus = 'succeeded';
        state.detail = action.payload;
      })
      .addCase(fetchStockDetail.rejected, (state) => { state.detailStatus = 'failed'; });
  },
});

export const { clearDetail } = stocksSlice.actions;
export default stocksSlice.reducer;
