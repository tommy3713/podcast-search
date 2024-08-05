import { configureStore } from '@reduxjs/toolkit';
import helloReducer from '@/features/helloSlice';
import searchReducer from '@/features/searchSlice';
const store = configureStore({
  reducer: {
    hello: helloReducer,
    search: searchReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export default store;
