import { configureStore } from '@reduxjs/toolkit';
import { persistReducer, persistStore } from 'redux-persist';
import storage from 'redux-persist/lib/storage'; // Use local storage
import { combineReducers } from 'redux';
import helloReducer from '@/features/helloSlice';
import searchReducer from '@/features/searchSlice';
import summaryReducer from '@/features/summarySlice';
import podcastListSliceReducer from '@/features/podcastListSlice';
import {
  FLUSH,
  REHYDRATE,
  PAUSE,
  PERSIST,
  PURGE,
  REGISTER,
} from 'redux-persist';

// Combine all reducers
const rootReducer = combineReducers({
  hello: helloReducer,
  search: searchReducer,
  summary: summaryReducer,
  podcastList: podcastListSliceReducer,
});

// Redux Persist configuration
const persistConfig = {
  key: 'root', // Key for local storage
  storage, // Use local storage
};

// Wrap the root reducer with persistReducer
const persistedReducer = persistReducer(persistConfig, rootReducer);

// Create the store
const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER], // Ignore redux-persist actions
      },
    }),
});

export const persistor = persistStore(store); // Create persistor for Redux Persist

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export default store;
