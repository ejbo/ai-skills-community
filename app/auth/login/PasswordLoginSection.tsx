'use client';

import { useState } from 'react';
import { ChevronDown, Mail } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LoginForm } from './LoginForm';

/**
 * Email/password login for SSO deploys: collapsed behind a low-key toggle (W3 is
 * the primary path; this stays for admin/service accounts) and with NO signup
 * link — self-service registration is closed on every deploy. Auto-expands when
 * the page is re-entered with ?error= so the failure message from a password
 * attempt is not hidden.
 */
export function PasswordLoginSection({
  callbackUrl,
  error,
}: {
  callbackUrl?: string;
  error?: string;
}) {
  const t = useTranslations('auth');
  const [open, setOpen] = useState(Boolean(error));

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted transition hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <Mail className="h-3.5 w-3.5" />
          {t('password_login_toggle')}
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
      </div>
    );
  }

  return (
    <div className="surface lit-edge rounded-2xl p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
        <Mail className="h-4 w-4" />
        {t('email_login')}
      </div>
      <LoginForm callbackUrl={callbackUrl} error={error} />
    </div>
  );
}
