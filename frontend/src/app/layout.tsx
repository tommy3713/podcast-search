import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';
import Link from 'next/link';
import { List, Search } from 'lucide-react';

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
      <body className={`${inter.className} text-black`}>
        <div className="bg-gray-50 min-h-screen flex flex-col">
          {/* Desktop Nav */}
          <header className="bg-blue-500 text-white shadow-md hidden sm:block">
            <nav className="max-w-4xl mx-auto flex justify-start items-center py-4 px-6 gap-5">
              <Link
                href="/search"
                className="text-lg font-semibold hover:underline"
              >
                Search
              </Link>
              <Link
                href="/podcast-list/gooaye"
                className="text-lg font-semibold hover:underline"
              >
                Podcast List
              </Link>
            </nav>
          </header>

          <main className="flex-grow">
            <Providers>{children}</Providers>
          </main>

          {/* Mobile Bottom Nav */}
          <nav className="sm:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex justify-around items-center py-2 shadow-md z-50">
            <Link
              href="/search"
              className="flex flex-col items-center text-gray-700 hover:text-blue-500"
            >
              <Search size={24} />
              <span className="text-xs mt-1">Search</span>
            </Link>
            <Link
              href="/podcast-list/gooaye"
              className="flex flex-col items-center text-gray-700 hover:text-blue-500"
            >
              <List size={24} />
              <span className="text-xs mt-1">List</span>
            </Link>
          </nav>
          <footer className="bg-gray-100 text-center py-4">
            <p className="text-sm text-gray-600">© 2025 Podcast Search</p>
          </footer>
        </div>
      </body>
    </html>
  );
}
