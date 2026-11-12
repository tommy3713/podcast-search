'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { STOCKS_LABEL } from '@/lib/stocks';

const LINKS = [
  { href: '/', desk: '集數', bottom: '首頁', match: (p: string) => p === '/' || p.startsWith('/ep/') },
  { href: '/stocks', desk: STOCKS_LABEL, bottom: STOCKS_LABEL, match: (p: string) => p === '/stocks' || p.startsWith('/stock/') },
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
