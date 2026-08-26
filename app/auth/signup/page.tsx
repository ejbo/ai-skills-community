import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { SignupForm } from './SignupForm';
import { auth, isSsoEnabled } from '@/lib/auth';
import { sanitizeCallbackPath } from '@/lib/auth/callback-path';

// House rule: page searchParams may be string[] — always read via firstParam.
function firstParam(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? '' : v ?? '';
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: { callbackUrl?: string | string[] };
}) {
  const callbackUrl = firstParam(searchParams.callbackUrl) || undefined;
  const session = await auth();
  if (session?.user) {
    redirect(sanitizeCallbackPath(callbackUrl, process.env.NEXT_PUBLIC_BASE_PATH ?? ''));
  }
  // SSO deploys close self-service signup — regular users go through W3, so a
  // direct /auth/signup visit bounces to the login page (API is closed too).
  if (isSsoEnabled) {
    redirect(`/auth/login${callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ''}`);
  }
  const t = await getTranslations('auth');

  return (
    <div className="container flex min-h-[calc(100vh-128px)] items-center justify-center py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900/[0.06] dark:bg-white/10 text-zinc-900 dark:text-zinc-50">
            <Sparkles className="h-5 w-5" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('signup')}</h1>
        </div>
        <div className="surface rounded-2xl p-5">
          <SignupForm callbackUrl={callbackUrl} />
          <p className="mt-4 text-center text-sm text-muted">
            <Link
              href={`/auth/login${callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ''}`}
              className="font-medium text-zinc-900 dark:text-zinc-50 hover:text-zinc-900"
            >
              {t('or_login')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
