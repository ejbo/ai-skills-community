'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';

/**
 * Back button that returns the user to wherever they came from, preserving
 * their previous scroll position (Next.js App Router restores scroll on
 * history pop, which `router.back()` triggers). When there is no in-app
 * history to return to — direct link, new tab, external referrer — it falls
 * back to `fallbackHref` so the button is never a dead end.
 */
export function BackButton({
  fallbackHref = '/skills',
  label = '返回',
}: {
  fallbackHref?: string;
  label?: string;
}) {
  const router = useRouter();
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    // history.length > 1 means there is a prior entry to pop back to within
    // this tab's session (a fresh tab / direct load has length 1).
    setCanGoBack(window.history.length > 1);
  }, []);

  return (
    <button
      type="button"
      onClick={() => (canGoBack ? router.back() : router.push(fallbackHref))}
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-muted transition hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:hover:bg-zinc-800 dark:hover:text-white"
    >
      <ArrowLeft className="h-4 w-4" />
      {label}
    </button>
  );
}
