'use client';

import { useState } from 'react';
import { ChevronDown, Mail } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LoginForm } from './LoginForm';

/**
 * Email/password login for SSO deploys: collapsed behind a low-key toggle (W3 is
 * the primary path; this stays for admin/service accounts) and with NO signup
 * link. Auto-expands when the page is re-entered with ?error= so the failure
 * message from a password attempt is not hidden.
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-auto flex items-center gap-1.5 text-sm text-muted transition hover:text-zinc-900"
      >
        <Mail className="h-3.5 w-3.5" />
        {t('password_login_toggle')}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <div className="surface rounded-2xl p-5">
      <div className="mb-4 flex items-center gap-2 text-sm font-medium text-muted">
        <Mail className="h-4 w-4" />
        {t('email_login')}
      </div>
      <LoginForm callbackUrl={callbackUrl} error={error} />
    </div>
  );
}
