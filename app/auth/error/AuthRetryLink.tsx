'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { loginHref } from '@/lib/auth/callback-path';
import { readAuthDest } from '@/lib/auth/pending-dest';

/**
 * 重新登录 — carrying the destination the failed attempt was headed for.
 *
 * @auth/core sends only `?error=<code>` here, so the server render can only use
 * a `?callbackUrl=` that something else put on the url. The breadcrumb the W3
 * button left in sessionStorage is read after mount and upgrades the href; the
 * first client render matches the server one, so there is no hydration
 * mismatch, and a browser that blocks storage just keeps the server href.
 */
export function AuthRetryLink({ callbackUrl, className }: { callbackUrl?: string; className?: string }) {
  const t = useTranslations('auth_error');
  const [href, setHref] = useState(() => loginHref(callbackUrl ?? null));

  useEffect(() => {
    if (callbackUrl) return; // an explicit one on the url always wins
    const remembered = readAuthDest();
    if (remembered) setHref(loginHref(remembered));
  }, [callbackUrl]);

  return (
    <Link href={href} className={className}>
      {t('retry')}
    </Link>
  );
}
