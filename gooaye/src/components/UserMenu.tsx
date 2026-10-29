'use client';

import { signIn, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';

export function LoginButton({ callbackUrl }: { callbackUrl?: string }) {
  const pathname = usePathname();
  return (
    <button className="btn primary" onClick={() => signIn('google', { callbackUrl: callbackUrl ?? pathname })}>
      <span className="gmark">G</span>用 Google 登入
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
