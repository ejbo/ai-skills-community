'use client';

import { useEffect, useRef, useState } from 'react';
import { SessionProvider, getSession } from 'next-auth/react';
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

/**
 * Session poll cadence for a VISIBLE tab, in seconds.
 *
 * Deliberately still UNDER lib/auth.ts' ROLE_CLAIMS_TTL_MS (90 s), and raising it
 * would cost more than it saves. Past the TTL the jwt callback re-reads the role row
 * on EVERY request that calls a bare auth() — it cannot persist the refresh, only
 * /api/auth/session re-signs the cookie — and auth() runs per media Range request, so
 * a longer poll puts a DB read back on every video seek: exactly the regression the
 * ROLE_CLAIMS_TTL_MS comment records. Lengthening it also WIDENS the stale window
 * instead of closing it, because the callback refreshes only once the claims are past
 * 90 s: a 60 s poll lands the refresh at 120 s, a 300 s poll not until 600 s.
 *
 * The idle-tab tax is therefore cut by not polling AT ALL while the tab is hidden
 * (below), not by slowing down the tab someone is actually using. That is where the
 * tax lives: a poll costs 2 requests in its own tab plus one in every other tab of
 * the browser, because next-auth's getSession() posts on a FRESHLY created
 * BroadcastChannel while the provider's listener sits on a different channel object —
 * a channel never receives its own posts, but this is not the same object, so the
 * poll is echoed back into the sending tab as a second /api/auth/session fetch.
 * T tabs cost T + T² session requests per minute; only one of them can be visible.
 */
const VISIBLE_REFETCH_SECONDS = 60;

/**
 * Floor on how often returning to a tab may re-sync the session, so alt-tabbing
 * cannot turn into a request per switch. The cookie is at most
 * VISIBLE_REFETCH_SECONDS old when the tab goes hidden, so it can only cross the
 * 90 s TTL after ~30 s away — a shorter round trip is already covered.
 */
const RESYNC_MIN_GAP_MS = 30_000;

export function AuthProvider({
  session,
  children,
}: {
  session: Session | null;
  children: React.ReactNode;
}) {
  const [visible, setVisible] = useState(true);
  // The RSC render that produced `session` just ran, so treat mount as a sync point:
  // a page load must never add a session request of its own.
  const lastSyncRef = useRef(Date.now());
  // Anonymous tabs have nothing to re-sync — and next-auth's own poll already skips
  // them (it bails when there is no client session), so returning to one must not
  // become the one background request a signed-out visitor pays.
  const signedIn = session !== null;

  useEffect(() => {
    const onVisibility = () => {
      const isVisible = document.visibilityState === 'visible';
      setVisible(isVisible);
      if (!isVisible || !signedIn || Date.now() - lastSyncRef.current < RESYNC_MIN_GAP_MS) return;
      lastSyncRef.current = Date.now();
      // Re-sign the cookie right away so the returning user's first requests find
      // fresh claims instead of paying a DB read each. `broadcast: false` is what
      // keeps this ONE request: the default fans a refetch out to every other tab
      // (and, via the channel-identity bug above, back into this one). It updates
      // the cookie but not the provider's React state — the resumed poll does that
      // within one interval, which is why this is not useSession().update() (that
      // POST flips status to 'loading' for every consumer and forces a DB read).
      void getSession({ broadcast: false });
    };
    // A tab can MOUNT hidden (restored window, opened in the background), so sync the
    // initial state — without the refresh, per lastSyncRef above.
    setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [signedIn]);

  return (
    <SessionProvider
      session={session}
      basePath={AUTH_BASE_PATH}
      // Left OFF even though we now refresh on return: next-auth's own handler is
      // unthrottled (its `now() < _lastSync` staleness guard compares whole seconds
      // to whole seconds and is effectively never true) and it broadcasts, so every
      // alt-tab would fan a refetch into every tab of the browser. The visibility
      // effect above does the same job throttled and echo-free.
      refetchOnWindowFocus={false}
      // Role/permission claims live in the JWT and are refreshed in lib/auth.ts'
      // jwt callback — but only /api/auth/session re-signs and SETS the cookie
      // (a bare auth() cannot), so an ACTIVE tab keeps polling at the cadence the
      // TTL wants. A hidden tab issues no requests at all, so its poll is pure
      // background load: 0 clears next-auth's timer (its effect keys on this prop)
      // and the visibility handler re-syncs when the tab comes back.
      refetchInterval={visible ? VISIBLE_REFETCH_SECONDS : 0}
    >
      {children}
    </SessionProvider>
  );
}
