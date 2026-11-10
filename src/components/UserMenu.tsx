'use client';

import { signIn, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';

export function LoginButton({ callbackUrl }: { callbackUrl?: string }) {
  const pathname = usePathname();
  return (
    // The header hides "用 Google " on phones (.login-long); the label keeps the full name
    <button className="btn primary" aria-label="用 Google 登入" onClick={() => signIn('google', { callbackUrl: callbackUrl ?? pathname })}>
      <span className="gmark" aria-hidden="true">G</span>
      <span>
        <span className="login-long">用 Google </span>登入
      </span>
    </button>
  );
}

export function UserMenu({ name }: { name: string | null }) {
  if (name === null) return <div className="user"><LoginButton /></div>;
  const initial = [...name.trim()][0]?.toUpperCase() ?? '?';
  return (
    <div className="user">
      <span className="name muted">{name}</span>
      <span className="avatar" title="已登入" aria-hidden="true">{initial}</span>
      <button className="btn ghost" onClick={() => signOut({ callbackUrl: '/' })}>登出</button>
    </div>
  );
}
