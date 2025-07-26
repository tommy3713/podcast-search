'use client';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import store, { persistor } from './store';
import LoadingComponent from './loading';
import { SessionProvider } from 'next-auth/react';
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Provider store={store}>
      <PersistGate loading={<LoadingComponent />} persistor={persistor}>
        <SessionProvider>{children}</SessionProvider>
      </PersistGate>
    </Provider>
  );
}
