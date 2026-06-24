'use client';

import { SessionProvider } from 'next-auth/react';
import type { Session } from 'next-auth';
import { installApiBasePathFetch } from '@/lib/patch-fetch';

// Install the basePath fetch shim as early as a client module can run, so every
// client-side fetch('/api/...') hits THIS app under the subpath, not the origin root.
// No-op at root / on the server.
installApiBasePathFetch();

// next-auth's React client derives its API base from NEXTAUTH_URL, which is NOT
// exposed to the browser (not a NEXT_PUBLIC_ var), so it falls back to "/api/auth"
// and ignores Next's basePath. On a subpath deploy (e.g. /ai-community) that means
// signIn()/signOut() would POST to <origin>/api/auth/* — i.e. the WRONG app behind
// nginx, breaking both login buttons and logout. Pinning basePath here routes those
// client calls to <NEXT_PUBLIC_BASE_PATH>/api/auth on THIS app. No-op at root
// (NEXT_PUBLIC_BASE_PATH unset → "/api/auth", the default).
const AUTH_BASE_PATH = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/api/auth`;

export function AuthProvider({
  session,
  children,
}: {
  session: Session | null;
  children: React.ReactNode;
}) {
  return (
    <SessionProvider
      session={session}
      basePath={AUTH_BASE_PATH}
      refetchOnWindowFocus={false}
    >
      {children}
    </SessionProvider>
  );
}
