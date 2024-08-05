// app/providers.tsx
'use client';
import { Provider } from 'react-redux';
import store from './store'; // Adjust the path based on your file structure
import type { AppProps } from 'next/app';
import { NextUIProvider } from '@nextui-org/react';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Provider store={store}>
      <NextUIProvider>{children}</NextUIProvider>
    </Provider>
  );
}
