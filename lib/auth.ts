import NextAuth, { customFetch, type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import type { Provider } from 'next-auth/providers';
import { prisma } from '@/lib/db';
import { verifyPassword } from '@/lib/auth/password';
import { env } from '@/lib/env';
import { createHuaweiFetch } from '@/lib/auth/huawei-fetch';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      handle: string;
      email: string;
      displayName: string;
      isAdmin: boolean;
      authMethod: 'password' | 'huawei_sso' | 'both';
      avatarUrl: string | null;
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
      // Huawei IDaaS supports `state` (CSRF) but NOT PKCE/nonce — don't let Auth.js add them.
      checks: ['state'],
      authorization: {
        url: env.SSO_AUTHORIZE_URL!,
        params: { scope: env.SSO_SCOPE, response_type: 'code', display: 'page' },
      },
      token: env.SSO_ACCESS_TOKEN_URL!,
      userinfo: env.SSO_USERINFO_URL!,
      // Map Huawei's real fields. Identity: uid → uuid → globalUserID (userinfo may
      // return ONLY uuid by default). Name: displayNameCn → displayName → cn → givenName.
      profile(raw: Record<string, unknown>) {
        const str = (v: unknown) => (v == null ? '' : String(v));
        const uid = str(raw.uid) || str(raw.uuid) || str(raw.globalUserID);
        const email = str(raw.email) || (uid ? `${uid}@huawei.com` : '');
        const name =
          str(raw.displayNameCn) || str(raw.displayName) || str(raw.cn) || str(raw.givenName) || uid;
        return { id: uid, email, name, huaweiW3Id: uid, displayName: name };
      },
      // Reshape the non-standard token/userinfo calls to Huawei's protocol (see huawei-fetch.ts).
      [customFetch]: createHuaweiFetch({
        clientId: env.SSO_CLIENT_ID,
        clientSecret: env.SSO_CLIENT_SECRET,
        scope: env.SSO_SCOPE,
        tokenUrl: env.SSO_ACCESS_TOKEN_URL!,
        userinfoUrl: env.SSO_USERINFO_URL!,
        verifySsl: env.SSO_VERIFY_SSL,
        useProxy: env.USE_PROXY,
        proxyHost: env.HUAWEI_PROXY_HOST,
        proxyPort: env.HUAWEI_PROXY_PORT,
      }),
    } as Provider);
  }

  return providers;
}

// Auth.js mounts its API at `<basePath>`. Under a Next.js subpath deploy the route
// handler actually lives at `<NEXT_BASE_PATH>/api/auth/*`, and @auth/core matches the
// incoming request path against `config.basePath` (`^<basePath>(.+)`) — so basePath
// MUST include the Next basePath, not just "/api/auth". If left to default, @auth/core
// derives it from AUTH_URL's pathname, which is an easy thing to get wrong (e.g.
// AUTH_URL=.../ai-community yields "/ai-community", breaking the callback). Pin it to
// the SAME build-time var the client `AuthProvider` and next.config use, so server and
// client never drift. Empty NEXT_PUBLIC_BASE_PATH ⇒ "/api/auth" (root deploy, unchanged).
const AUTH_BASE_PATH = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/api/auth`;

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: env.AUTH_SECRET,
  basePath: AUTH_BASE_PATH,
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
        session.user.avatarUrl = null;
        // Freshen mutable profile fields from the DB so an avatar / display-name
        // change shows immediately (the navbar reads `session.user.avatarUrl`),
        // without forcing a re-login — the JWT alone would be stale.
        if (token.uid) {
          const dbUser = await prisma.user.findUnique({
            where: { id: token.uid as string },
            select: { avatarUrl: true, displayName: true },
          });
          if (dbUser) {
            session.user.avatarUrl = dbUser.avatarUrl;
            session.user.image = dbUser.avatarUrl;
            session.user.displayName = dbUser.displayName;
          }
        }
      }
      return session;
    },
  },
});

export const isSsoEnabled = env.ENABLE_SSO && !!env.SSO_CLIENT_ID && !!env.SSO_CLIENT_SECRET;
