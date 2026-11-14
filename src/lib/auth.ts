import { type AuthOptions, getServerSession } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';

// Login exists only to rate-limit Q&A. The session keeps the Google account id (sub)
// and display name; nothing is stored server-side except ask_usage/ask_log rows.
export const authOptions: AuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    }),
  ],
  session: { strategy: 'jwt', maxAge: 30 * 24 * 3600 },
  callbacks: {
    jwt({ token, profile }) {
      // Drop email and picture; keep only what the site shows or counts by
      if (profile) return { sub: token.sub, name: token.name };
      return token;
    },
    session({ session, token }) {
      return { expires: session.expires, user: { id: token.sub ?? '', name: token.name ?? '' } };
    },
  },
};

export type SessionUser = { id: string; name: string };

export async function currentUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  const user = session?.user as Partial<SessionUser> | undefined;
  return user?.id ? { id: user.id, name: user.name ?? '' } : null;
}

// Admins are Google account ids (the sub) in ADMIN_USER_ID, comma-separated. Unset: nobody.
export function isAdmin(user: SessionUser | null): boolean {
  if (!user?.id) return false;
  return (process.env.ADMIN_USER_ID ?? '')
    .split(',')
    .map((s) => s.trim())
    .includes(user.id);
}

// The signed-in admin, or null. Admin pages and APIs answer 404 to everyone else.
export async function currentAdmin(): Promise<SessionUser | null> {
  const user = await currentUser();
  return isAdmin(user) ? user : null;
}
