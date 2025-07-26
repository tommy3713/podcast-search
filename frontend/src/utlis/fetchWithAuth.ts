import { getSession } from 'next-auth/react';

export async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const session = await getSession();
  const token = session?.id_token;

  if (!token) throw new Error('尚未登入');

  const headers = {
    ...options.headers,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  return fetch(url, {
    ...options,
    headers,
  });
}
