import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type AskStatus = 'idle' | 'loading' | 'streaming' | 'succeeded' | 'failed' | 'unauthenticated' | 'rate_limited';

export interface Source {
  podcaster: string;
  episode: string;
  title: string;
  fullTitle: string;
}

interface AskState {
  question: string;
  answer: string;
  sources: Source[];
  status: AskStatus;
}

const initialState: AskState = {
  question: '',
  answer: '',
  sources: [],
  status: 'idle',
};

const askSlice = createSlice({
  name: 'ask',
  initialState,
  reducers: {
    setQuestion(state, action: PayloadAction<string>) {
      state.question = action.payload;
    },
    startAsking(state) {
      state.answer = '';
      state.sources = [];
      state.status = 'loading';
    },
    setStreaming(state) {
      state.status = 'streaming';
    },
    setSources(state, action: PayloadAction<Source[]>) {
      state.sources = action.payload;
    },
    appendAnswer(state, action: PayloadAction<string>) {
      state.answer += action.payload;
    },
    setStatus(state, action: PayloadAction<AskStatus>) {
      state.status = action.payload;
    },
  },
});

export const { setQuestion, startAsking, setStreaming, setSources, appendAnswer, setStatus } = askSlice.actions;
export default askSlice.reducer;
