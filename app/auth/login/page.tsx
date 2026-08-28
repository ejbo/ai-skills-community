import { redirect } from 'next/navigation';
import { ShieldCheck, TriangleAlert, ArrowLeft, CornerDownLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { LoginForm } from './LoginForm';
import { HuaweiLoginButton } from './HuaweiLoginButton';
import { PasswordLoginSection } from './PasswordLoginSection';
import { auth, isSsoEnabled } from '@/lib/auth';
import { isReturnableDest, sanitizeCallbackPath } from '@/lib/auth/callback-path';
import { withBasePath } from '@/lib/base-path';
import { HeroBackdrop } from '@/app/_components/home/HeroBackdrop';

// House rule: page searchParams may be string[] — always read via firstParam.
function firstParam(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? '' : v ?? '';
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { callbackUrl?: string | string[]; error?: string | string[] };
}) {
  const callbackUrl = firstParam(searchParams.callbackUrl) || undefined;
  const session = await auth();
  if (session?.user) {
    redirect(sanitizeCallbackPath(callbackUrl, process.env.NEXT_PUBLIC_BASE_PATH ?? ''));
  }
  const [t, tHome, tErr] = await Promise.all([
    getTranslations('auth'),
    getTranslations('home'),
    getTranslations('auth_error'),
  ]);
  // Only password failures belong inside the credentials form. Any other code
  // (Auth.js sign-in-kind errors: AccessDenied, OAuthCallbackError, …) used to
  // render as "邮箱或密码错误" — show it as an SSO/server notice with the raw
  // code instead, so users can quote it to the developer.
  const rawError = firstParam(searchParams.error) || undefined;
  const credentialsError = rawError === 'CredentialsSignin' ? rawError : undefined;
  const ssoErrorCode =
    rawError && !credentialsError
      ? rawError.replace(/[^\w.-]/g, '').slice(0, 64) || 'Default'
      : undefined;
  // A callbackUrl means the visitor arrived from a shared/deep link. Say so —
  // "you will be taken back" is the reassurance that stops people from
  // abandoning at the wall, and it is the visible half of the redirect fix.
  const returnTo = sanitizeCallbackPath(callbackUrl, process.env.NEXT_PUBLIC_BASE_PATH ?? '');
  // `isReturnableDest` also rules out /auth/* — otherwise a crafted
  // ?callbackUrl=/auth/login would have the page promise to send the visitor
  // back to the login page.
  const hasReturn = isReturnableDest(returnTo);

  // Value panel, desktop only: three of the surfaces the account unlocks. The
  // copy is the homepage's own (home.surface_*) rather than a second set of
  // strings to keep in sync across three locales.
  const highlights = ['skills', 'discussion', 'library'] as const;

  return (
    <section className="relative overflow-hidden">
      <HeroBackdrop intensity="soft" />
      <div className="container relative flex min-h-[calc(100vh-140px)] items-center justify-center py-10 md:py-14">
        <div className="grid w-full max-w-4xl items-center gap-12 lg:grid-cols-[1fr_minmax(0,360px)] lg:gap-16">
          {/* ── Value panel (lg+) ─────────────────────────────────────────── */}
          <div className="animate-rise hidden lg:block">
            <img
              src={withBasePath('/CARI_logo.webp')}
              alt="CARI"
              className="h-9 w-auto"
            />
            <h1 className="mt-6 text-3xl font-semibold tracking-tight">{t('welcome_title')}</h1>
            <p className="mt-3 max-w-sm text-base leading-relaxed text-muted">
              {t('welcome_sub')}
            </p>
            <ul className="mt-7 space-y-3">
              {highlights.map((key) => (
                <li key={key} className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-900 dark:bg-zinc-100"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{tHome(`surface_${key}_title`)}</p>
                    <p className="mt-0.5 text-sm leading-relaxed text-muted">
                      {tHome(`surface_${key}_body`)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* ── Sign-in column ────────────────────────────────────────────── */}
          <div className="animate-rise mx-auto w-full max-w-sm" style={{ animationDelay: '90ms' }}>
            {/* Mobile header — the value panel is hidden there, so the page
                still has to introduce itself. */}
            <div className="mb-7 text-center lg:hidden">
              <img
                src={withBasePath('/CARI_logo.webp')}
                alt="CARI"
                className="mx-auto h-9 w-auto"
              />
              <h1 className="mt-4 text-2xl font-semibold tracking-tight">{t('welcome_title')}</h1>
            </div>

            {hasReturn && (
              <p className="mb-4 flex items-start gap-2 rounded-xl border border-zinc-200 bg-white/70 px-3.5 py-2.5 text-xs leading-relaxed text-muted backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/60">
                <CornerDownLeft className="mt-px h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1">
                  {t('return_notice')}
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-zinc-900 dark:text-zinc-100">
                    {withBasePath(returnTo)}
                  </span>
                </span>
              </p>
            )}

            {ssoErrorCode && (
              <div className="mb-4 rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm">
                <p className="flex items-center gap-2 font-medium text-danger">
                  <TriangleAlert className="h-4 w-4 shrink-0" />
                  {tErr('banner_title')}
                </p>
                <p className="mt-1.5 text-muted">{tErr('banner_body', { code: ssoErrorCode })}</p>
              </div>
            )}

            {isSsoEnabled ? (
              // SSO deploy: W3 is THE way in — one big, unmissable button.
              // Password login stays available but collapsed (admin/service
              // accounts), and self-service signup is closed everywhere.
              <div className="space-y-4">
                <div className="surface lit-edge rounded-2xl p-5 shadow-sm">
                  <div className="mb-1 flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4" />
                    <span className="text-sm font-semibold">{t('huawei_login')}</span>
                    <span className="ml-auto rounded-full border border-zinc-300 px-2 py-0.5 text-[11px] font-medium text-muted dark:border-zinc-700">
                      {t('recommended')}
                    </span>
                  </div>
                  <p className="mb-4 text-xs leading-relaxed text-muted">{t('w3_hint')}</p>
                  <HuaweiLoginButton callbackUrl={callbackUrl} />
                </div>
                <PasswordLoginSection callbackUrl={callbackUrl} error={credentialsError} />
              </div>
            ) : (
              // External deploy (no SSO): email/password only. Registration is
              // closed on every deploy, so there is no signup link here either.
              <div className="surface lit-edge rounded-2xl p-5 shadow-sm">
                <div className="mb-4 text-sm font-semibold">{t('email_login')}</div>
                <LoginForm callbackUrl={callbackUrl} error={credentialsError} />
              </div>
            )}

            <p className="mt-5 text-center text-xs leading-relaxed text-muted">
              {t('signup_closed')}
            </p>
            <p className="mt-3 text-center">
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 text-xs text-muted transition hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                {t('back_home')}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
