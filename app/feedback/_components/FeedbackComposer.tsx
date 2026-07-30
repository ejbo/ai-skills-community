'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2, MessageSquarePlus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { FeedbackCategory } from '@prisma/client';
import { pushToast } from '@/components/Toaster';
import { RichTextEditor } from '@/components/RichTextEditor';
import { CATEGORY_META } from './badges';

const CATEGORIES = Object.entries(CATEGORY_META) as [
  FeedbackCategory,
  (typeof CATEGORY_META)[FeedbackCategory],
][];

/** Collapsed "提交反馈" button that expands into the inline new-feedback form. */
export function FeedbackComposer({ loggedIn }: { loggedIn: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations('feedback');
  const g = useTranslations();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<FeedbackCategory>('feature');
  const [bodyMd, setBodyMd] = useState('');
  const [busy, setBusy] = useState(false);

  function openForm() {
    if (!loggedIn) {
      pushToast('error', t('login_before_submit'));
      router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
      return;
    }
    setOpen(true);
  }

  async function submit() {
    if (title.trim().length < 4) {
      pushToast('error', t('title_min'));
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), category, bodyMd }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        pushToast('error', g('video.login_required'));
        router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
        return;
      }
      if (!res.ok) {
        pushToast('error', data.reason ?? t('submit_failed_retry'));
        return;
      }
      pushToast('success', t('submitted_thanks'));
      router.push(`/feedback/${data.feedback.id}`);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={openForm}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 transition hover:border-accent-500 hover:text-accent-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-accent-400 dark:hover:text-accent-300"
      >
        <MessageSquarePlus className="h-4 w-4" />
        {t('submit_feedback')}
      </button>
    );
  }

  return (
    <div className="surface w-full space-y-3 rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t('submit_feedback')}</h3>
        <button
          onClick={() => setOpen(false)}
          aria-label={g('video.detail.collapse')}
          className="rounded p-1 text-muted hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <input
        autoFocus
        placeholder={t('title_placeholder')}
        value={title}
        maxLength={120}
        onChange={(e) => setTitle(e.target.value)}
        className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
      />

      <div className="flex items-center gap-2">
        {CATEGORIES.map(([key, meta]) => (
          <button
            key={key}
            onClick={() => setCategory(key)}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              category === key
                ? 'border-accent-500 bg-accent-500/10 font-medium text-accent-600 dark:text-accent-300'
                : `${meta.className} hover:border-accent-400`
            }`}
          >
            {t(`category_${key}`)}
          </button>
        ))}
      </div>

      <RichTextEditor
        value={bodyMd}
        onChange={setBodyMd}
        variant="compact"
        maxLength={10000}
        placeholder={t('body_placeholder')}
        ariaLabel={t('body_aria')}
      />

      <div className="flex justify-end">
        <button
          onClick={submit}
          disabled={busy}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-60"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t('submit')}
        </button>
      </div>
    </div>
  );
}
