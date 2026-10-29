import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { fetchWithAuth } from '@/utils/fetchWithAuth';

export type Relation = '新增' | '重複' | '更新' | '反轉';
export type Focus = '主角' | '背景';

export interface ThreadEntry {
  episode: string;
  date: string;
  relation: Relation;
  reason: string;
  reference: string;
  focus: Focus;
  why?: string;
}

export interface Thread {
  id: string;
  label: string;
  history: ThreadEntry[];
}

export interface AnalysisEpisode {
  episode: string;
  date: string;
  fullTitle: string;
  reason_count: number;
}

export interface AnalysisSummary {
  key: string;
  company: string;
  range: string;
  generated_at: string;
  episode_count: number;
  thread_count: number;
  reason_count: number;
  first_episode: string | null;
  last_episode: string | null;
  first_date: string | null;
  last_date: string | null;
}

export interface CompanyAnalysis extends AnalysisSummary {
  episodes: AnalysisEpisode[];
  threads: Thread[];
}

type Status = 'idle' | 'loading' | 'succeeded' | 'failed';

interface AnalysisState {
  list: AnalysisSummary[];
  listStatus: Status;
  current: CompanyAnalysis | null;
  status: Status;
  error: string | undefined;
}

const initialState: AnalysisState = {
  list: [],
  listStatus: 'idle',
  current: null,
  status: 'idle',
  error: undefined,
};

export const fetchAnalysisList = createAsyncThunk(
  'analysis/fetchAnalysisList',
  async (_, { rejectWithValue }) => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/analysis`);
      if (!response.ok) {
        const err = await response.json().catch(() => null);
        throw new Error(err?.error || 'Network response was not ok');
      }
      return (await response.json()) as AnalysisSummary[];
    } catch (error) {
      return rejectWithValue((error as Error).message);
    }
  }
);

export const fetchAnalysis = createAsyncThunk(
  'analysis/fetchAnalysis',
  async (key: string, { rejectWithValue }) => {
    try {
      const response = await fetchWithAuth(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/analysis/${encodeURIComponent(key)}`
      );
      if (response.status === 404) throw new Error('這家公司還沒有做過跨集數分析');
      if (!response.ok) {
        const err = await response.json().catch(() => null);
        throw new Error(err?.error || 'Network response was not ok');
      }
      return (await response.json()) as CompanyAnalysis;
    } catch (error) {
      return rejectWithValue((error as Error).message);
    }
  }
);

const analysisSlice = createSlice({
  name: 'analysis',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchAnalysisList.pending, (state) => {
        state.listStatus = 'loading';
      })
      .addCase(fetchAnalysisList.fulfilled, (state, action) => {
        state.listStatus = 'succeeded';
        state.list = action.payload;
      })
      .addCase(fetchAnalysisList.rejected, (state) => {
        state.listStatus = 'failed';
      })
      .addCase(fetchAnalysis.pending, (state) => {
        state.status = 'loading';
        state.error = undefined;
      })
      .addCase(fetchAnalysis.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.current = action.payload;
      })
      .addCase(fetchAnalysis.rejected, (state, action) => {
        state.status = 'failed';
        state.current = null;
        state.error = action.payload as string;
      });
  },
});

export default analysisSlice.reducer;
