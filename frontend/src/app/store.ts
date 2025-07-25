import { configureStore } from '@reduxjs/toolkit';
import helloReducer from '@/features/helloSlice';
import searchReducer from '@/features/searchSlice';
import summaryReducer from '@/features/summarySlice';
import podcastListSliceReducer from '@/features/podcastListSlice';
const store = configureStore({
  reducer: {
    hello: helloReducer,
    search: searchReducer,
    summary: summaryReducer,
    podcastList: podcastListSliceReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export default store;
