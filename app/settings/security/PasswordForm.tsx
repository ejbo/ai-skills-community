'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';

export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const t = useTranslations('settings');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      pushToast('error', t('password_mismatch'));
      return;
    }
    if (next.length < 8) {
      pushToast('error', t('password_too_short'));
      return;
    }
    startTransition(async () => {
      const res = await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ current: hasPassword ? current : undefined, next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const map: Record<string, string> = {
          current_required: t('current_required'),
          wrong_password: t('wrong_password'),
        };
        pushToast('error', map[data.error] ?? t('save_failed'));
        return;
      }
      setCurrent('');
      setNext('');
      setConfirm('');
      pushToast('success', t('password_updated'));
    });
  }

  return (
    <form onSubmit={submit} className="surface space-y-3 rounded-2xl p-5">
      {hasPassword && (
        <Field label={t('current_password')}>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
            className="input"
          />
        </Field>
      )}
      <Field label={t('new_password')}>
        <input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
          className="input"
        />
      </Field>
      <Field label={t('confirm_password')}>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
          className="input"
        />
      </Field>
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-4 text-sm font-medium text-white dark:text-zinc-900 transition hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-60"
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t('update_password')}
        </button>
      </div>
      <style jsx>{`
        .input {
          width: 100%;
          height: 2.5rem;
          padding: 0 0.75rem;
          border-radius: 0.5rem;
          border: 1px solid rgb(var(--border));
          background: rgb(var(--surface));
          font-size: 0.875rem;
          transition: border-color 150ms;
        }
        .input:focus {
          border-color: rgb(var(--accent));
          outline: none;
          box-shadow: 0 0 0 3px rgb(var(--accent) / 0.15);
        }
      `}</style>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
