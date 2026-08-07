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
      className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-accent-500 text-sm font-medium text-white transition hover:bg-accent-600"
    >
      <ShieldCheck className="h-4 w-4" />
      {t('w3_button')}
    </button>
  );
}
