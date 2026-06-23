'use client';

import { signIn } from 'next-auth/react';
import { ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { withBasePath } from '@/lib/base-path';

export function HuaweiLoginButton({ callbackUrl }: { callbackUrl?: string }) {
  const t = useTranslations('auth');
  // The W3 flow ends in a server-side redirect (not the Next router), so the post-login
  // destination is NOT auto-prefixed with the deploy basePath. Prefix it ourselves so we
  // land on /ai-community/… and not the host root (which on the shared host is another app).
  const dest = withBasePath(callbackUrl ?? '/');
  return (
    <button
      onClick={() => signIn('huawei', { callbackUrl: dest })}
      className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
    >
      <ShieldCheck className="h-4 w-4 text-source-internal" />
      {t('w3_button')}
    </button>
  );
}
