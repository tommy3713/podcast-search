'use client';

import { signIn, signOut } from 'next-auth/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// compact: the header's button, which reads just "登入" on phones (CSS hides .login-long
// there) while its accessible name stays the full one
export function LoginButton({ callbackUrl, compact = false }: { callbackUrl?: string; compact?: boolean }) {
  const pathname = usePathname();
  return (
    <button
      className="btn primary"
      aria-label={compact ? '用 Google 登入' : undefined}
      // With the query string, so /ask?q= still has its question after the login
      onClick={() => signIn('google', { callbackUrl: callbackUrl ?? pathname + window.location.search })}
    >
      <span className="gmark" aria-hidden="true">G</span>
      {compact ? (
        <span>
          <span className="login-long">用 Google </span>登入
        </span>
      ) : (
        '用 Google 登入'
      )}
    </button>
  );
}

// admin: the signed-in account is in ADMIN_USER_ID, so the header links to /admin
export function UserMenu({ name, admin = false }: { name: string | null; admin?: boolean }) {
  if (name === null) return <div className="user"><LoginButton compact /></div>;
  const initial = [...name.trim()][0]?.toUpperCase() ?? '?';
  return (
    <div className="user">
      {admin && <Link className="btn ghost" href="/admin" prefetch={false}>管理</Link>}
      <span className="name muted">{name}</span>
      <span className="avatar" title="已登入" aria-hidden="true">{initial}</span>
      <button className="btn ghost" onClick={() => signOut({ callbackUrl: '/' })}>登出</button>
    </div>
  );
}
