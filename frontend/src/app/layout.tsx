import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';
import Link from 'next/link';
import { List, MessageCircle, Search } from 'lucide-react';
import LoginButton from '@/components/LoginButton';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Podcast Search',
  description: 'Podcast gooaye content search',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="bg-white">
      <head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0"
        ></meta>
      </head>
      <Providers>
        <body className={`${inter.className} text-black`}>
          <div className="bg-gray-50 h-screen flex flex-col">
            {/* Desktop Nav */}
            <header className="bg-white text-gray-800 border-b border-gray-200 shadow-sm hidden sm:block">
              <nav className="max-w-5xl mx-auto flex justify-between items-center py-4 px-6 gap-4">
                <div className="flex items-start justify-start">
                  <Link
                    href="/search"
                    className="px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-100 hover:text-blue-700 transition"
                  >
                    🔍 Search
                  </Link>
                  <Link
                    href="/podcast-list/gooaye"
                    className="px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-100 hover:text-blue-700 transition"
                  >
                    🎧 Podcast List
                  </Link>
                  <Link
                    href="/ask"
                    className="px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-100 hover:text-blue-700 transition"
                  >
                    🤖 Ask
                  </Link>
                </div>
                <LoginButton />
              </nav>
            </header>
            {/* Mobile Top Nav */}
            <header className="sm:hidden sticky top-0 z-40 bg-white border-b border-gray-200 shadow-sm px-4 py-2 flex justify-between items-center">
              <h1 className="text-base font-semibold text-gray-800">
                Podcast Search
              </h1>
              <LoginButton />
            </header>

            <main className="flex-1 overflow-y-auto">{children}</main>

            {/* Mobile Bottom Nav */}
            <nav className="sm:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex justify-around items-center h-14 pb-safe shadow-md z-50">
              <Link
                href="/search"
                className="flex flex-col items-center justify-center min-h-[44px] px-6 text-gray-700 hover:text-blue-500"
              >
                <Search size={22} />
                <span className="text-xs mt-1">Search</span>
              </Link>
              <Link
                href="/podcast-list/gooaye"
                className="flex flex-col items-center justify-center min-h-[44px] px-6 text-gray-700 hover:text-blue-500"
              >
                <List size={22} />
                <span className="text-xs mt-1">List</span>
              </Link>
              <Link
                href="/ask"
                className="flex flex-col items-center justify-center min-h-[44px] px-6 text-gray-700 hover:text-blue-500"
              >
                <MessageCircle size={22} />
                <span className="text-xs mt-1">Ask</span>
              </Link>
            </nav>
            <footer className="bg-gray-100 text-center py-2 pb-16 sm:pb-2">
              <a
                href="https://ko-fi.com/tommy3713"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[#c4c2b8] hover:text-[#1a1a1a] transition-colors"
              >
                喜歡這個工具？請我喝杯咖啡
              </a>
            </footer>
          </div>
        </body>
      </Providers>
    </html>
  );
}
