import NextAuth, { customFetch, type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import type { Provider } from 'next-auth/providers';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { verifyPassword } from '@/lib/auth/password';
import { syncDirectoryToUserAtLogin } from '@/lib/employee-directory';
import { env } from '@/lib/env';
import { createHuaweiFetch } from '@/lib/auth/huawei-fetch';
import { buildAuthCookies } from '@/lib/auth/cookies';
import { hostBypassesProxy } from '@/lib/net/proxy';
import { rateLimit, releaseRateLimit } from '@/lib/rate-limit';
import { cache as reactCache } from 'react';
import { ROLE_SELECT, roleForUserRow, type EffectiveRole } from '@/lib/roles';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      handle: string;
      email: string;
      displayName: string;
      /** Derived "staff" flag (any permission at all) — what 管理后台 entry checks read. */
      isAdmin: boolean;
      /** Role key (`super_admin` | `admin` | `member` | custom). Feed `can(session.user, …)`. */
      roleKey: string;
      /** Permission keys from lib/permissions.ts (super_admin carries `['*']`). */
      permissions: string[];
      authMethod: 'password' | 'huawei_sso' | 'both';
      avatarUrl: string | null;
    } & DefaultSession['user'];
  }
}

const LOGIN_WINDOW_MS = 10 * 60 * 1000;
/** FAILED attempts per targeted account — the credential-stuffing half. */
const LOGIN_ATTEMPTS_PER_EMAIL = 10;
/**
 * FAILED attempts per client address — the CPU half (see the note in
 * `authorize`). It is deliberately an order of magnitude looser than the
 * per-email budget because this bucket is SHARED: a whole office reaches the
 * intranet box through one NAT egress address, so the ceiling has to clear a
 * morning of everyone's typos, not a morning of everyone's logins (successes
 * are refunded). 200 per 10 min is 20 failures a minute from one address —
 * far past what any human population mistypes, and still a hard bound on a
 * script: every attempt that reaches bcrypt costs it ~97 ms of our single
 * thread, so one address can burn at most ~19 s of CPU per window (~3%).
 */
const LOGIN_ATTEMPTS_PER_IP = 200;

// Same anon-key convention as DiscussionTopicView: x-real-ip is set by our
// nginx from $remote_addr; the FIRST x-forwarded-for hop is client-forgeable
// (nginx appends, it does not replace), so fall back to the LAST hop.
// null ⇒ no proxy in front of Node (the external AWS deploy's shape, and that
// deploy is email/password ONLY) — the caller then SKIPS the IP bucket. A
// literal 'unknown' key would put every visitor on earth in one bucket: a
// site-wide login outage, presented to each of them as 邮箱或密码错误.
// @auth/core always hands `authorize` a request, but a missing one must degrade
// rather than throw — a throw here is a Configuration error that would break
// every login.
function loginClientIp(h: Headers | undefined): string | null {
  return (
    h?.get('x-real-ip')?.trim() ||
    h
      ?.get('x-forwarded-for')
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .pop() ||
    null
  );
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
      async authorize(credentials, request) {
        const email = String(credentials?.email ?? '').toLowerCase().trim();
        const password = String(credentials?.password ?? '');
        if (!email || !password) return null;

        // bcrypt at cost 12 is ~97 ms of UNINTERRUPTIBLE work on the single JS
        // thread, so an unthrottled login form is a whole-site stall as much as
        // it is a credential-stuffing hole. Two buckets, and the ORDER matters:
        // the per-IP one is checked first, which also bounds how many distinct
        // per-email buckets one attacker can mint in the limiter's Map.
        // Only FAILURES are charged — both buckets are released on the way out
        // of a successful sign-in, so legitimate traffic can never spend the
        // budget it shares with everyone behind the same egress address.
        // A throttled attempt must fail EXACTLY like a wrong password —
        // returning null yields `CredentialsSignin`, the only code
        // app/auth/login/page.tsx renders as 邮箱或密码错误 (a custom code shows
        // the generic SSO banner instead, and LoginForm's `redirect: false`
        // path can't tell them apart anyway).
        const ip = loginClientIp(request?.headers);
        // Slice both keys: neither the header nor the email is validated input,
        // and each is what names its bucket.
        const ipKey = ip ? `login:ip:${ip.slice(0, 64)}` : null;
        if (ipKey && !rateLimit(ipKey, LOGIN_ATTEMPTS_PER_IP, LOGIN_WINDOW_MS).allowed) return null;
        const emailKey = `login:email:${email.slice(0, 120)}`;
        if (!rateLimit(emailKey, LOGIN_ATTEMPTS_PER_EMAIL, LOGIN_WINDOW_MS).allowed) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.passwordHash || !user.isActive) return null;
        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) return null;
        // Correct credentials: refund what this attempt charged.
        if (ipKey) releaseRateLimit(ipKey);
        releaseRateLimit(emailKey);
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
        // Per-host, NOT the raw USE_PROXY flag: uniportal is an intranet host and
        // the corporate proxy refuses internal destinations, so turning the proxy
        // on for 知识库 must not drag W3 login through it. The default bypass list
        // (.huawei.com) already sends uniportal direct.
        useProxy: env.USE_PROXY && !hostBypassesProxy(new URL(env.SSO_ACCESS_TOKEN_URL!).hostname),
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
const PUBLIC_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const AUTH_BASE_PATH = `${PUBLIC_BASE_PATH}/api/auth`;

// Same derivation @auth/core uses internally (AUTH_URL protocol — reqWithEnvURL
// rewrites every inbound origin to AUTH_URL's). Passed explicitly so the default
// cookie attrs and OUR cookie names below can never disagree. Read the RAW env,
// not `env.AUTH_URL`: zod's http://localhost:3000 default is invisible to
// next-auth, and an https production deploy that legitimately omits AUTH_URL
// (trustHost via AUTH_TRUST_HOST) must still get Secure cookies — hence the
// NODE_ENV fallback. Https deploys SHOULD set AUTH_URL=https://… regardless.
const RAW_AUTH_URL = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? '';
const USE_SECURE_COOKIES = RAW_AUTH_URL
  ? RAW_AUTH_URL.startsWith('https://')
  : process.env.NODE_ENV === 'production';

/**
 * How stale the role/permission claims in the JWT may get before a refresh.
 * Deliberately LONGER than the SessionProvider's 60 s refetchInterval
 * (components/AuthProvider.tsx): that poll hits /api/auth/session, which is the
 * one path that re-signs and SETS the cookie. A bare `auth()` in a route handler
 * or RSC cannot persist a refreshed token (next-auth's no-arg auth() discards
 * the Set-Cookie), so without the poll every auth() after the TTL would re-query.
 */
const ROLE_CLAIMS_TTL_MS = 90_000;

const PROFILE_CLAIMS_SELECT = {
  displayName: true,
  avatarUrl: true,
  isAdmin: true,
  isActive: true,
  role: { select: ROLE_SELECT },
} as const;

type ProfileClaimsRow = Parameters<typeof roleForUserRow>[0] & {
  displayName: string;
  avatarUrl: string | null;
  isActive: boolean;
};

const NO_ROLE: EffectiveRole = {
  roleId: null,
  roleKey: 'member',
  roleName: '普通成员',
  permissions: [],
  isStaff: false,
  isSuperAdmin: false,
};

// One DB read per request even if several auth() calls find the claims stale
// (layout + page + route all call auth()). React's cache is request-scoped in
// the server build and undefined elsewhere — fall back to the bare function.
const memo: <T extends (...args: never[]) => unknown>(fn: T) => T =
  typeof reactCache === 'function' ? reactCache : (fn) => fn;
const loadProfileClaims = memo(async (userId: string): Promise<ProfileClaimsRow | null> =>
  prisma.user.findUnique({ where: { id: userId }, select: PROFILE_CLAIMS_SELECT }),
);

function applyRoleClaims(token: Record<string, unknown>, role: EffectiveRole) {
  token.isAdmin = role.isStaff;
  token.roleKey = role.roleKey;
  token.perms = role.permissions;
  token.permsAt = Date.now();
}

function applyProfileClaims(token: Record<string, unknown>, row: ProfileClaimsRow) {
  token.displayName = row.displayName;
  token.avatarUrl = row.avatarUrl;
  // A disabled account keeps its cookie until expiry (pre-existing), but it must
  // not keep — or regain — any role power through a refresh.
  applyRoleClaims(token, row.isActive ? roleForUserRow(row) : NO_ROLE);
}

function roleClaimsStale(token: Record<string, unknown>): boolean {
  const at = token.permsAt;
  return typeof at !== 'number' || Date.now() - at > ROLE_CLAIMS_TTL_MS;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: env.AUTH_SECRET,
  basePath: AUTH_BASE_PATH,
  session: { strategy: 'jwt' },
  providers: buildProviders(),
  useSecureCookies: USE_SECURE_COOKIES,
  // App-scoped cookie names + paths (lib/auth/cookies.ts). The shared host also
  // answers on its pre-2026-07 hostname alias, and the default host-wide
  // `authjs.*` Path=/ cookies are what let stale / wrong-jar state cookies kill
  // the W3 callback with "InvalidCheck: state value could not be parsed".
  cookies: buildAuthCookies({ basePath: PUBLIC_BASE_PATH, secure: USE_SECURE_COOKIES }),
  // @auth/core puts these VERBATIM into Location headers (no basePath
  // prefixing), so they must carry the deploy prefix themselves or error
  // redirects land on the host root — which on the shared box is another app.
  pages: {
    signIn: `${PUBLIC_BASE_PATH}/auth/login`,
    error: `${PUBLIC_BASE_PATH}/auth/error`,
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === 'huawei') {
        const w3Id = (user as { huaweiW3Id?: string }).huaweiW3Id;
        if (!w3Id) return false;

        // First-login provisioning must be IDEMPOTENT: the OAuth callback can
        // fire twice near-simultaneously (double click, second tab, gateway
        // prefetch), and with a naive check-then-act both racers see "no user
        // yet" — the loser then dies on a unique index, so a brand-new user's
        // VERY FIRST login 500s while the retry succeeds (the winner's row now
        // exists). Hence: link if present; on create-conflict fall back to
        // linking; only a squatted handle (a password account registered with
        // the 工号 as its email local part) warrants a suffixed re-create.
        const linkExisting = async (): Promise<boolean> => {
          const existing = await prisma.user.findFirst({
            where: { OR: [{ huaweiW3Id: w3Id }, { email: user.email ?? undefined }] },
          });
          if (!existing) return false;
          await prisma.user.update({
            where: { id: existing.id },
            data: {
              huaweiW3Id: w3Id,
              authMethod: existing.passwordHash ? 'both' : 'huawei_sso',
              lastLoginAt: new Date(),
              // Backfill the immutable W3 name for accounts created before this field
              // existed — but only when empty, so it's set exactly once and never changes.
              ...(existing.huaweiW3Name ? {} : { huaweiW3Name: user.name ?? null }),
            },
          });
          return true;
        };
        const createFresh = (handle: string) =>
          prisma.user.create({
            data: {
              email: user.email!,
              handle,
              displayName: user.name ?? w3Id, // editable later by the user
              huaweiW3Id: w3Id,
              huaweiW3Name: user.name ?? null, // immutable record of the W3 identity
              authMethod: 'huawei_sso',
              avatarUrl: (user as { image?: string }).image ?? null,
              lastLoginAt: new Date(),
            },
          });

        if (!(await linkExisting())) {
          try {
            await createFresh(w3Id);
          } catch (e) {
            const isUniqueConflict =
              e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
            if (!isUniqueConflict) throw e;
            // Re-read as the authority: a concurrent callback just created us.
            if (!(await linkExisting())) {
              // huaweiW3Id/email are still free ⇒ the conflict was the handle.
              await createFresh(`${w3Id}-${Date.now().toString(36).slice(-4)}`);
            }
          }
        }
        // 员工名单：按工号把部门/研究所挂到刚登录的账号上（best-effort，绝不阻断登录）。
        // 只用 W3 验证过的 id 匹配 — 见 lib/employee-directory.ts 的安全说明。
        await syncDirectoryToUserAtLogin([w3Id]);
      } else if (account?.provider === 'credentials' && user?.email) {
        const updated = await prisma.user.update({
          where: { email: user.email },
          data: { lastLoginAt: new Date() },
          select: { huaweiW3Id: true },
        });
        await syncDirectoryToUserAtLogin([updated.huaweiW3Id]);
      }
      return true;
    },
    async jwt({ token, user, trigger }) {
      if (user) {
        // Sign-in: seed the token with everything the app reads from the session,
        // including the mutable profile fields (avatar / display name) and the role.
        // W3 logins must look up by 工号, not email: the profile email can be a
        // synthesized `<uid>@huawei.com` while the linked row keeps a real
        // corporate address (or vice versa) — an email miss here would mint a
        // session with no uid/handle, i.e. "logged in" but broken everywhere.
        const w3Id = (user as { huaweiW3Id?: string }).huaweiW3Id;
        const dbUser = await prisma.user.findUnique({
          where: w3Id ? { huaweiW3Id: w3Id } : { email: user.email! },
          select: { ...PROFILE_CLAIMS_SELECT, id: true, handle: true, authMethod: true },
        });
        if (dbUser) {
          token.uid = dbUser.id;
          token.handle = dbUser.handle;
          token.authMethod = dbUser.authMethod;
          applyProfileClaims(token, dbUser);
        }
      } else if (token.uid && (trigger === 'update' || roleClaimsStale(token))) {
        // Refresh the mutable claims (a) when the client calls `useSession().update()`
        // after a profile edit and (b) once the claims are older than ROLE_CLAIMS_TTL_MS,
        // so a role change / demotion / 停用 lands within ~a minute WITHOUT a DB query
        // on every request (the old per-request re-query hurt every video range/seek).
        // Persistence: ONLY the session endpoint re-signs the cookie, and the
        // SessionProvider polls it every 60 s (< TTL), so an active tab never lets the
        // claims go stale for bare auth() callers; a returning idle tab pays one memoized
        // read per request until its first poll. See ROLE_CLAIMS_TTL_MS above.
        const dbUser = await loadProfileClaims(token.uid as string);
        if (dbUser) applyProfileClaims(token, dbUser);
      }
      return token;
    },
    async session({ session, token }) {
      // Read everything from the JWT — NO database query per request.
      if (token && session.user) {
        session.user.id = token.uid as string;
        session.user.handle = token.handle as string;
        session.user.isAdmin = Boolean(token.isAdmin);
        session.user.roleKey = typeof token.roleKey === 'string' ? token.roleKey : 'member';
        session.user.permissions = Array.isArray(token.perms)
          ? (token.perms as unknown[]).filter((p): p is string => typeof p === 'string')
          : [];
        session.user.authMethod = (token.authMethod as 'password' | 'huawei_sso' | 'both') ?? 'password';
        session.user.displayName = (token.displayName as string) ?? session.user.name ?? '';
        session.user.avatarUrl = (token.avatarUrl as string | null) ?? null;
        session.user.image = (token.avatarUrl as string | null) ?? null;
      }
      return session;
    },
  },
});

export const isSsoEnabled = env.ENABLE_SSO && !!env.SSO_CLIENT_ID && !!env.SSO_CLIENT_SECRET;
