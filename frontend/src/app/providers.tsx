'use client';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import store, { persistor } from './store';
import { Spinner } from '@nextui-org/react';

function LoadingComponent() {
  return (
    <div className="flex justify-center items-center h-screen bg-gray-50">
      <Spinner size="lg" color="primary" />{' '}
    </div>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Provider store={store}>
      <PersistGate loading={<LoadingComponent />} persistor={persistor}>
        {children}
      </PersistGate>
    </Provider>
  );
}
