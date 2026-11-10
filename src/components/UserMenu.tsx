'use client';

import { signIn, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';

// compact: the header's button, which reads just "登入" on phones (CSS hides .login-long
// there) while its accessible name stays the full one
export function LoginButton({ callbackUrl, compact = false }: { callbackUrl?: string; compact?: boolean }) {
  const pathname = usePathname();
  return (
    <button
      className="btn primary"
      aria-label={compact ? '用 Google 登入' : undefined}
      onClick={() => signIn('google', { callbackUrl: callbackUrl ?? pathname })}
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

export function UserMenu({ name }: { name: string | null }) {
  if (name === null) return <div className="user"><LoginButton compact /></div>;
  const initial = [...name.trim()][0]?.toUpperCase() ?? '?';
  return (
    <div className="user">
      <span className="name muted">{name}</span>
      <span className="avatar" title="已登入" aria-hidden="true">{initial}</span>
      <button className="btn ghost" onClick={() => signOut({ callbackUrl: '/' })}>登出</button>
    </div>
  );
}
