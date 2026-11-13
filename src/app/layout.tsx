import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, Noto_Serif_TC } from 'next/font/google';
import Link from 'next/link';
import { BrandMark } from '@/components/BrandMark';
import { Nav } from '@/components/Nav';
import { ThemeToggle } from '@/components/ThemeToggle';
import { UserMenu } from '@/components/UserMenu';
import { currentUser } from '@/lib/auth';
import { isProduction } from '@/lib/env';
import { SITE_NAME, SITE_URL } from '@/lib/seo';
import { THEME_SCRIPT } from '@/lib/theme';
import './globals.css';

// Body text uses the system CJK font; only headings and timestamps load web fonts.
// CJK fonts are split into unicode-range chunks, so nothing is preloaded.
const serif = Noto_Serif_TC({ weight: ['600', '700'], preload: false, variable: '--font-serif', display: 'swap' });
const mono = IBM_Plex_Mono({ weight: ['400', '500'], subsets: ['latin'], variable: '--font-plex-mono', display: 'swap' });

const DESCRIPTION = '《股癌 Gooaye》每集重點、帶時間戳的逐字稿，和跨集數問答。非官方粉絲網站。';

// Cloudflare Web Analytics (no cookies). Added by hand: Cloudflare's automatic injection never
// showed up on these pages. The token is public; it ends up in every page's source anyway.
const CF_BEACON_TOKEN = '424e8a7cb76249c5bfb1635542b82a8d';

// The share image comes from app/opengraph-image.png (X falls back to it)
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE_NAME}｜股癌 Gooaye 每集重點・逐字稿`, template: `%s・${SITE_NAME}` },
  description: DESCRIPTION,
  openGraph: { siteName: SITE_NAME, locale: 'zh_TW', type: 'website', description: DESCRIPTION },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = { viewportFit: 'cover' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    // The theme script sets data-theme on <html> before React hydrates
    <html lang="zh-Hant-TW" className={`${serif.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <header className="top">
          <div className="wrap">
            <Link className="brand" href="/">
              <BrandMark />
              <span className="brand-name">股癌搜尋</span>
            </Link>
            {!isProduction() && <span className="pill warn">DEV</span>}
            <Nav variant="desk" />
            <div className="actions">
              <ThemeToggle />
              <UserMenu name={user?.name ?? null} />
            </div>
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
        {/* Only the live site counts visits; the CSP in deploy/gooaye.caddy allows both hosts */}
        {isProduction() && (
          <script
            type="module"
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon={JSON.stringify({ token: CF_BEACON_TOKEN })}
          />
        )}
      </body>
    </html>
  );
}
