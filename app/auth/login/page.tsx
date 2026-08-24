import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Sparkles, ShieldCheck, Mail, TriangleAlert } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { LoginForm } from './LoginForm';
import { HuaweiLoginButton } from './HuaweiLoginButton';
import { PasswordLoginSection } from './PasswordLoginSection';
import { auth, isSsoEnabled } from '@/lib/auth';
import { sanitizeCallbackPath } from '@/lib/auth/callback-path';

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
  const t = await getTranslations('auth');
  const tErr = await getTranslations('auth_error');
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

  return (
    <div className="container flex min-h-[calc(100vh-128px)] items-center justify-center py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-accent-500/15 text-accent-600">
            <Sparkles className="h-5 w-5" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('choose_method')}</h1>
        </div>

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
          // SSO deploy: W3 is THE way in. Password login stays available but
          // collapsed (admin/service accounts), and self-service signup is
          // closed — no link here, /auth/signup redirects, the API 403s.
          <div className="space-y-4">
            <div className="surface rounded-2xl p-5">
              <div className="mb-4 flex items-center gap-2 text-sm font-medium text-muted">
                <ShieldCheck className="h-4 w-4" />
                {t('huawei_login')}
              </div>
              <HuaweiLoginButton callbackUrl={callbackUrl} />
            </div>
            <PasswordLoginSection
              callbackUrl={callbackUrl}
              error={credentialsError}
            />
          </div>
        ) : (
          // External deploy (no SSO): email/password with self-service signup.
          <div className="surface rounded-2xl p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-medium text-muted">
              <Mail className="h-4 w-4" />
              {t('email_login')}
            </div>
            <LoginForm callbackUrl={callbackUrl} error={credentialsError} />
            <p className="mt-4 text-center text-sm text-muted">
              <Link
                href={`/auth/signup${callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ''}`}
                className="font-medium text-accent-600 hover:text-accent-700"
              >
                {t('or_signup')}
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
