// src/features/helloSlice.ts
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

// Define a type for the slice state
interface HelloState {
  message: string;
  status: 'idle' | 'loading' | 'succeeded' | 'failed';
  error: string | null;
}

// Initial state
const initialState: HelloState = {
  message: '',
  status: 'idle',
  error: null,
};

// Async thunk action for fetching the message
export const fetchMessage = createAsyncThunk('hello/fetchMessage', async () => {
  const response = await fetch(`${process.env.BACKEND_URL}/hello`);
  const data = await response.json();
  return data.message; // Assuming the message is in { message: "string" }
});

// Slice to handle the state and reducers
const helloSlice = createSlice({
  name: 'hello',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchMessage.pending, (state) => {
        state.status = 'loading';
      })
      .addCase(fetchMessage.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.message = action.payload;
      })
      .addCase(fetchMessage.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.error.message || 'Failed to fetch message';
      });
  },
});

export default helloSlice.reducer;
