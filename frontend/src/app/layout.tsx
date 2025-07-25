import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';
import Link from 'next/link';

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
          <header className="bg-blue-500 text-white shadow-md">
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
          <footer className="bg-gray-100 text-center py-4">
            <p className="text-sm text-gray-600">© 2025 Podcast Search</p>
          </footer>
        </div>
      </body>
    </html>
  );
}
