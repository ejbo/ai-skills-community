'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { RotateCw, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * The app-wide route error boundary. There was none before, so ANY throw during
 * a render — chiefly a Prisma P2024 pool timeout once the single Node process is
 * saturated — dead-ended on Next's built-in "Application error: a client-side
 * exception has occurred", which tells a user nothing and offers no way out.
 *
 * This renders INSIDE the root layout, so the nav bar and both providers are
 * still mounted: `useTranslations` works, and `reset()` re-renders the failed
 * segment in place — for a transient pool timeout that is usually all it takes.
 * The layout's OWN failures escape this boundary; app/global-error.tsx catches
 * those.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('common');

  useEffect(() => {
    // The real stack is server-side only (Next redacts the message and hands the
    // browser a `digest` instead), so log the digest: it is the ONLY token that
    // ties a user's screenshot back to a line in the server log.
    console.error('[route error]', error.digest ?? error.message);
  }, [error]);

  return (
    <div className="container flex min-h-[calc(100vh-128px)] items-center justify-center py-12">
      <div className="w-full max-w-md">
        <div className="surface rounded-2xl p-6 text-center">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-danger/10 text-danger">
            <TriangleAlert className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{t('error_title')}</h1>
          <p className="mt-3 text-sm text-muted">{t('error_desc')}</p>
          {error.digest ? (
            <p className="surface mt-4 inline-flex items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-xs text-muted">
              {t('error_code')}: {error.digest}
            </p>
          ) : null}
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={reset}
              className="flex h-10 items-center justify-center gap-2 rounded-lg bg-zinc-900 px-5 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              <RotateCw className="h-4 w-4" />
              {t('error_retry')}
            </button>
            <Link
              href="/"
              className="surface flex h-10 items-center justify-center rounded-lg px-5 text-sm font-medium text-muted transition hover:text-zinc-900"
            >
              {t('error_home')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
