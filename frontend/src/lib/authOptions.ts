import GoogleProvider from 'next-auth/providers/google';
import type { NextAuthOptions } from 'next-auth';
import { DefaultJWT } from 'next-auth/jwt';

declare module 'next-auth' {
  interface Account {
    id_token?: string;
    refresh_token?: string;
    expires_at?: number;
  }
  interface Session {
    id_token?: string;
    error?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT extends DefaultJWT {
    id_token?: string;
    refresh_token?: string;
    expires_at?: number;
    error?: string;
  }
}

async function refreshIdToken(refreshToken: string): Promise<{
  id_token: string;
  expires_at: number;
} | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) return null;

  const data = await res.json();
  return {
    id_token: data.id_token,
    expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
  };
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: 'openid email profile',
          access_type: 'offline',
          prompt: 'consent',
        },
      },
      idToken: true,
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      // Initial sign in — store tokens and expiry
      if (account) {
        return {
          ...token,
          id_token: account.id_token,
          refresh_token: account.refresh_token,
          expires_at: account.expires_at,
        };
      }

      // Token still valid (with 60s buffer)
      if (token.expires_at && Date.now() / 1000 < token.expires_at - 60) {
        return token;
      }

      // Token expired — refresh
      if (!token.refresh_token) {
        return { ...token, error: 'RefreshTokenMissing' };
      }

      const refreshed = await refreshIdToken(token.refresh_token);
      if (!refreshed) {
        return { ...token, error: 'RefreshTokenError' };
      }

      return {
        ...token,
        id_token: refreshed.id_token,
        expires_at: refreshed.expires_at,
        error: undefined,
      };
    },
    async session({ session, token }) {
      session.id_token = token.id_token;
      session.error = token.error;
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
