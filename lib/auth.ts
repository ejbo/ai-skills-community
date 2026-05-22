import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import type { Provider } from 'next-auth/providers';
import { prisma } from '@/lib/db';
import { verifyPassword } from '@/lib/auth/password';
import { env } from '@/lib/env';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      handle: string;
      email: string;
      displayName: string;
      isAdmin: boolean;
      authMethod: 'password' | 'huawei_sso' | 'both';
    } & DefaultSession['user'];
  }
}

function buildProviders(): Provider[] {
  const providers: Provider[] = [
    Credentials({
      id: 'credentials',
      name: 'Email & Password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? '').toLowerCase().trim();
        const password = String(credentials?.password ?? '');
        if (!email || !password) return null;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.passwordHash || !user.isActive) return null;
        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.displayName,
          handle: user.handle,
          displayName: user.displayName,
          isAdmin: user.isAdmin,
          authMethod: user.authMethod,
        };
      },
    }),
  ];

  if (env.ENABLE_SSO && env.SSO_CLIENT_ID && env.SSO_CLIENT_SECRET) {
    providers.push({
      id: 'huawei',
      name: 'Huawei W3',
      type: 'oauth',
      clientId: env.SSO_CLIENT_ID,
      clientSecret: env.SSO_CLIENT_SECRET,
      authorization: {
        url: env.SSO_AUTHORIZE_URL!,
        params: { scope: env.SSO_SCOPE, response_type: 'code' },
      },
      token: env.SSO_ACCESS_TOKEN_URL!,
      userinfo: env.SSO_USERINFO_URL!,
      profile(raw: Record<string, unknown>) {
        const uid = String(raw.uid ?? raw.employee_id ?? raw.sub ?? '');
        const email = String(raw.email ?? `${uid}@huawei.com`);
        const name = String(raw.cn ?? raw.display_name ?? raw.name ?? uid);
        return { id: uid, email, name, huaweiW3Id: uid, displayName: name };
      },
    } as Provider);
  }

  return providers;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: env.AUTH_SECRET,
  session: { strategy: 'jwt' },
  providers: buildProviders(),
  pages: {
    signIn: '/auth/login',
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === 'huawei') {
        const w3Id = (user as { huaweiW3Id?: string }).huaweiW3Id;
        if (!w3Id) return false;
        const existing = await prisma.user.findFirst({
          where: { OR: [{ huaweiW3Id: w3Id }, { email: user.email ?? undefined }] },
        });
        if (existing) {
          await prisma.user.update({
            where: { id: existing.id },
            data: {
              huaweiW3Id: w3Id,
              authMethod: existing.passwordHash ? 'both' : 'huawei_sso',
              lastLoginAt: new Date(),
            },
          });
        } else {
          await prisma.user.create({
            data: {
              email: user.email!,
              handle: w3Id,
              displayName: user.name ?? w3Id,
              huaweiW3Id: w3Id,
              authMethod: 'huawei_sso',
              avatarUrl: (user as { image?: string }).image ?? null,
              lastLoginAt: new Date(),
            },
          });
        }
      } else if (account?.provider === 'credentials' && user?.email) {
        await prisma.user.update({
          where: { email: user.email },
          data: { lastLoginAt: new Date() },
        });
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        const dbUser = await prisma.user.findUnique({ where: { email: user.email! } });
        if (dbUser) {
          token.uid = dbUser.id;
          token.handle = dbUser.handle;
          token.isAdmin = dbUser.isAdmin;
          token.authMethod = dbUser.authMethod;
          token.displayName = dbUser.displayName;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.uid as string;
        session.user.handle = token.handle as string;
        session.user.isAdmin = Boolean(token.isAdmin);
        session.user.authMethod = (token.authMethod as 'password' | 'huawei_sso' | 'both') ?? 'password';
        session.user.displayName = (token.displayName as string) ?? session.user.name ?? '';
      }
      return session;
    },
  },
});

export const isSsoEnabled = env.ENABLE_SSO && !!env.SSO_CLIENT_ID && !!env.SSO_CLIENT_SECRET;
