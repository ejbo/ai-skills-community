import Link from 'next/link';
import { TriangleAlert } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

// Auth.js redirects hard sign-in failures here (pages.error in lib/auth.ts) with
// `?error=<type>` — before this page existed users dead-ended on the built-in
// English "Server error / There is a problem with the server configuration" page
// with no way forward. Show a human explanation, the raw code (what the
// developer needs to correlate with the server log), and a retry path.

const KNOWN = ['configuration', 'accessdenied', 'verification'] as const;

// House rule: page searchParams may be string[] — always read via firstParam.
function firstParam(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? '' : v ?? '';
}

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: { error?: string | string[] };
}) {
  const t = await getTranslations('auth_error');
  // The code is attacker-influenceable query input — strip to a plain token.
  // (@auth/core's legacy /api/auth/error action with no query redirects here
  // with the stringified `error=undefined` — map junk tokens to Default.)
  let rawCode = firstParam(searchParams.error).replace(/[^\w.-]/g, '').slice(0, 64) || 'Default';
  if (/^(undefined|null)$/i.test(rawCode)) rawCode = 'Default';
  const knownKey = KNOWN.find((k) => k === rawCode.toLowerCase()) ?? 'default';

  return (
    <div className="container flex min-h-[calc(100vh-128px)] items-center justify-center py-12">
      <div className="w-full max-w-md">
        <div className="surface rounded-2xl p-6 text-center">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-danger/10 text-danger">
            <TriangleAlert className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-3 text-sm text-muted">{t(`desc_${knownKey}`)}</p>
          <p className="surface mt-4 inline-flex items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-xs text-muted">
            {t('code_label')}: {rawCode}
          </p>
          <p className="mt-4 text-xs text-muted">{t('contact')}</p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Link
              href="/auth/login"
              className="flex h-10 items-center justify-center rounded-lg bg-accent-500 px-5 text-sm font-medium text-white transition hover:bg-accent-600"
            >
              {t('retry')}
            </Link>
            <Link
              href="/"
              className="surface flex h-10 items-center justify-center rounded-lg px-5 text-sm font-medium text-muted transition hover:text-accent-600"
            >
              {t('home')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
