import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, Noto_Serif_TC } from 'next/font/google';
import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { UserMenu } from '@/components/UserMenu';
import { currentUser } from '@/lib/auth';
import './globals.css';

// Body text uses the system CJK font; only headings and timestamps load web fonts.
// CJK fonts are split into unicode-range chunks, so nothing is preloaded.
const serif = Noto_Serif_TC({ weight: ['600', '700'], preload: false, variable: '--font-serif', display: 'swap' });
const mono = IBM_Plex_Mono({ weight: ['400', '500'], subsets: ['latin'], variable: '--font-plex-mono', display: 'swap' });

export const metadata: Metadata = {
  title: { default: '股癌搜尋', template: '%s・股癌搜尋' },
  description: '《股癌 Gooaye》每集重點、帶時間戳的逐字稿，和跨集數問答。非官方粉絲網站。',
};

export const viewport: Viewport = { viewportFit: 'cover' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="zh-Hant-TW" className={`${serif.variable} ${mono.variable}`}>
      <body>
        <header className="top">
          <div className="wrap">
            <Link className="brand" href="/">
              <span className="brand-mark">股</span>股癌搜尋
            </Link>
            <Nav variant="desk" />
            <UserMenu name={user?.name ?? null} />
          </div>
        </header>
        <main>
          <div className="wrap">{children}</div>
          <footer className="wrap">
            <div className="foot">
              <p>
                股癌搜尋是非官方粉絲網站，與《股癌》節目及謝孟恭無關。逐字稿和重點由 AI 自動產生，可能有誤，以原節目為準；內容不構成投資建議。
                <Link href="/about">關於與聲明</Link>
              </p>
            </div>
          </footer>
        </main>
        <Nav variant="bottom" />
      </body>
    </html>
  );
}
