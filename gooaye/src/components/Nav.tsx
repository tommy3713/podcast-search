'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', desk: '集數', bottom: '首頁', match: (p: string) => p === '/' || p.startsWith('/ep/') },
  { href: '/about', desk: '關於', bottom: '關於', match: (p: string) => p === '/about' },
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
