'use client';

// Minimal create step: name the activity, get a draft id, land in the editor
// (the draft IS the resumable upload target — everything else happens there).

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';
import { VOTE_TITLE_MAX } from '@/lib/votes/shared';
import { loginHref } from '@/lib/auth/callback-path';

export function CreateVoteForm() {
  const t = useTranslations('votes');
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/votes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
      if (res.status === 401) {
        pushToast('error', t('login_required'));
        router.push(loginHref('/votes/new'));
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.activity?.id) {
        pushToast('error', t('create_failed'));
        setBusy(false);
        return;
      }
      router.push(`/votes/${data.activity.id}/edit`);
    } catch {
      pushToast('error', t('create_failed'));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="surface rounded-2xl border border-zinc-200/70 p-6 dark:border-zinc-800/70">
      <label htmlFor="vote-title" className="block text-sm font-medium">
        {t('create_name_label')}
      </label>
      <input
        id="vote-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={VOTE_TITLE_MAX}
        placeholder={t('create_name_placeholder')}
        autoFocus
        className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-400"
      />
      <p className="mt-2 text-xs text-muted">{t('create_hint')}</p>
      <button
        type="submit"
        disabled={busy || !title.trim()}
        className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-4 text-sm font-medium text-white dark:text-zinc-900 transition hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {t('create_submit')}
      </button>
    </form>
  );
}
