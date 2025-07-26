import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import type { NextAuthOptions } from 'next-auth';
import { DefaultJWT } from 'next-auth/jwt';

declare module 'next-auth' {
  interface Account {
    id_token?: string;
  }
  interface Session {
    id_token?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT extends DefaultJWT {
    id_token?: string;
  }
}
export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: 'openid email profile',
        },
      },
      idToken: true,
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account?.id_token) {
        token.id_token = account.id_token;
      }
      return token;
    },
    async session({ session, token }) {
      session.id_token = token.id_token;
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
