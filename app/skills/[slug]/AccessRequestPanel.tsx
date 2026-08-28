'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { loginHref } from '@/lib/auth/callback-path';
import { Lock, Clock, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';

export type RequestState = 'none' | 'pending' | 'rejected' | 'revoked';

/**
 * Shown in place of the install/download area on a RESTRICTED skill when the
 * viewer can't yet access content. Drives the apply-for-download flow.
 */
export function AccessRequestPanel({
  slug,
  state,
  loggedIn,
}: {
  slug: string;
  state: RequestState;
  loggedIn: boolean;
}) {
  const t = useTranslations('skill_detail');
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [pending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);

  async function apply() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/skills/${slug}/access-request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: message.trim() || undefined }),
      });
      if (res.ok) {
        pushToast('success', t('request_submitted'));
        startTransition(() => router.refresh());
      } else if (res.status === 401) {
        router.push(loginHref(`/skills/${slug}`));
      } else {
        const j = await res.json().catch(() => ({}));
        pushToast('error', j.message || t('submit_failed'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const shell = 'surface rounded-2xl border border-warn/30 p-4';
  const codeTag = (chunks: React.ReactNode) => (
    <code className="rounded bg-zinc-100 px-1 font-mono text-[12px] dark:bg-zinc-800">{chunks}</code>
  );

  if (!loggedIn) {
    return (
      <div className={shell}>
        <div className="flex items-center gap-2 text-sm font-medium">
          <Lock className="h-4 w-4 text-warn" />
          {t('restricted_title')}
        </div>
        <p className="mt-1.5 text-sm text-muted">
          {t.rich('restricted_desc_login', { code: codeTag })}
        </p>
        <button
          onClick={() => router.push(loginHref(`/skills/${slug}`))}
          className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-3 text-sm font-medium text-white dark:text-zinc-900 transition hover:bg-zinc-700 dark:hover:bg-zinc-300"
        >
          {t('login_to_apply')}
        </button>
      </div>
    );
  }

  if (state === 'pending') {
    return (
      <div className={shell}>
        <div className="flex items-center gap-2 text-sm font-medium text-warn">
          <Clock className="h-4 w-4" />
          {t('request_pending')}
        </div>
        <p className="mt-1.5 text-sm text-muted">{t('request_pending_desc')}</p>
      </div>
    );
  }

  return (
    <div className={shell}>
      <div className="flex items-center gap-2 text-sm font-medium">
        <Lock className="h-4 w-4 text-warn" />
        {t('restricted_title')}
      </div>
      <p className="mt-1.5 text-sm text-muted">
        {t.rich('restricted_desc', { code: codeTag })}
        {state === 'rejected' && t('request_rejected_note')}
        {state === 'revoked' && t('request_revoked_note')}
      </p>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={t('request_reason_placeholder')}
        maxLength={500}
        rows={2}
        className="mt-3 w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-zinc-900 dark:focus:border-zinc-100 dark:border-zinc-700 dark:bg-zinc-900"
      />
      <button
        onClick={apply}
        disabled={submitting || pending}
        className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-3 text-sm font-medium text-white dark:text-zinc-900 transition hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-60"
      >
        <Send className="h-3.5 w-3.5" />
        {t('apply_download')}
      </button>
    </div>
  );
}
