import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Sparkles, ShieldCheck, Mail } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { LoginForm } from './LoginForm';
import { HuaweiLoginButton } from './HuaweiLoginButton';
import { auth, isSsoEnabled } from '@/lib/auth';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { callbackUrl?: string; error?: string };
}) {
  const session = await auth();
  if (session?.user) redirect(searchParams.callbackUrl ?? '/');
  const t = await getTranslations('auth');

  return (
    <div className="container flex min-h-[calc(100vh-128px)] items-center justify-center py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-accent-500/15 text-accent-600">
            <Sparkles className="h-5 w-5" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('choose_method')}</h1>
        </div>

        <div className="space-y-4">
          <div className="surface rounded-2xl p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-medium text-muted">
              <Mail className="h-4 w-4" />
              {t('email_login')}
            </div>
            <LoginForm callbackUrl={searchParams.callbackUrl} error={searchParams.error} />
            <p className="mt-4 text-center text-sm text-muted">
              <Link
                href={`/auth/signup${searchParams.callbackUrl ? `?callbackUrl=${encodeURIComponent(searchParams.callbackUrl)}` : ''}`}
                className="font-medium text-accent-600 hover:text-accent-700"
              >
                {t('or_signup')}
              </Link>
            </p>
          </div>

          {isSsoEnabled && (
            <>
              <div className="relative">
                <div className="absolute inset-0 flex items-center" aria-hidden>
                  <div className="w-full border-t border-zinc-200 dark:border-zinc-800" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-[rgb(var(--bg))] px-3 text-xs uppercase tracking-wider text-muted">
                    {t('or_divider')}
                  </span>
                </div>
              </div>

              <div className="surface rounded-2xl p-5">
                <div className="mb-4 flex items-center gap-2 text-sm font-medium text-muted">
                  <ShieldCheck className="h-4 w-4" />
                  {t('huawei_login')}
                </div>
                <HuaweiLoginButton callbackUrl={searchParams.callbackUrl} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
