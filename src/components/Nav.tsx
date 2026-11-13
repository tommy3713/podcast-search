'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', desk: '集數', bottom: '首頁', match: (p: string) => p === '/' || p.startsWith('/ep/') },
  // Stocks, sponsors and the mention categories are all under 主題
  { href: '/topics', desk: '主題', bottom: '主題', match: (p: string) => /^\/(topics?|stocks?|sponsors?)(\/|$)/.test(p) },
  { href: '/ask', desk: 'AI問答', bottom: 'AI問答', match: (p: string) => p === '/ask' },
];

export function Nav({ variant }: { variant: 'desk' | 'bottom' }) {
  const pathname = usePathname();
  return (
    <nav className={variant}>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={l.match(pathname) ? 'page' : undefined}>
          {l[variant]}
        </Link>
      ))}
    </nav>
  );
}
