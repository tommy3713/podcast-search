import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type ChatStatus =
  | 'idle'
  | 'loading'
  | 'streaming'
  | 'succeeded'
  | 'failed'
  | 'unauthenticated'
  | 'rate_limited';

export interface Source {
  podcaster: string;
  episode: string;
  title: string;
  fullTitle: string;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  isStreaming?: boolean;
}

interface ChatState {
  messages: Message[];
  input: string;
  status: ChatStatus;
}

const initialState: ChatState = {
  messages: [],
  input: '',
  status: 'idle',
};

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    setInput(state, action: PayloadAction<string>) {
      state.input = action.payload;
    },
    addUserMessage(state, action: PayloadAction<string>) {
      state.messages.push({ role: 'user', content: action.payload });
    },
    startAssistantMessage(state) {
      state.messages.push({ role: 'assistant', content: '', isStreaming: true });
      state.status = 'streaming';
    },
    appendToLastMessage(state, action: PayloadAction<string>) {
      const last = state.messages[state.messages.length - 1];
      if (last) last.content += action.payload;
    },
    setLastMessageSources(state, action: PayloadAction<Source[]>) {
      const last = state.messages[state.messages.length - 1];
      if (last) last.sources = action.payload;
    },
    finalizeLastMessage(state) {
      const last = state.messages[state.messages.length - 1];
      if (last) last.isStreaming = false;
    },
    setStatus(state, action: PayloadAction<ChatStatus>) {
      state.status = action.payload;
    },
    clearChat() {
      return initialState;
    },
  },
});

export const {
  setInput,
  addUserMessage,
  startAssistantMessage,
  appendToLastMessage,
  setLastMessageSources,
  finalizeLastMessage,
  setStatus,
  clearChat,
} = chatSlice.actions;

export default chatSlice.reducer;
