'use client';

import { signIn } from 'next-auth/react';
import { ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { withBasePath } from '@/lib/base-path';
import { sanitizeCallbackPath } from '@/lib/auth/callback-path';
import { rememberAuthDest } from '@/lib/auth/pending-dest';

export function HuaweiLoginButton({ callbackUrl }: { callbackUrl?: string }) {
  const t = useTranslations('auth');
  // The W3 flow ends in a server-side redirect (not the Next router), so the post-login
  // destination is NOT auto-prefixed with the deploy basePath. Prefix it ourselves so we
  // land on /ai-community/… and not the host root (which on the shared host is another app).
  // Sanitize first: rejects absolute/protocol-relative URLs and strips an
  // already-present basePath, so a crafted ?callbackUrl can't double-prefix or escape.
  const appPath = sanitizeCallbackPath(callbackUrl, process.env.NEXT_PUBLIC_BASE_PATH ?? '');
  const dest = withBasePath(appPath);
  return (
    <button
      onClick={() => {
        // Breadcrumb for /auth/error: @auth/core drops the callbackUrl when the
        // W3 callback fails, and the cookie holding it is path-scoped to
        // /api/auth. Store the basePath-FREE path — loginHref re-derives from it.
        rememberAuthDest(appPath);
        void signIn('huawei', { callbackUrl: dest });
      }}
      className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
    >
      <ShieldCheck className="h-4 w-4" />
      {t('w3_button')}
    </button>
  );
}
