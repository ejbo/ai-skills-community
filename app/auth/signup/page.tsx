import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { SignupForm } from './SignupForm';
import { auth } from '@/lib/auth';

export default async function SignupPage({
  searchParams,
}: {
  searchParams: { callbackUrl?: string };
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
          <h1 className="text-2xl font-semibold tracking-tight">{t('signup')}</h1>
        </div>
        <div className="surface rounded-2xl p-5">
          <SignupForm callbackUrl={searchParams.callbackUrl} />
          <p className="mt-4 text-center text-sm text-muted">
            <Link
              href={`/auth/login${searchParams.callbackUrl ? `?callbackUrl=${encodeURIComponent(searchParams.callbackUrl)}` : ''}`}
              className="font-medium text-accent-600 hover:text-accent-700"
            >
              {t('or_login')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
