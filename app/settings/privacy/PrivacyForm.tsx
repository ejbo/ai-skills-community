'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';

export function PrivacyForm({ initialIsPrivate }: { initialIsPrivate: boolean }) {
  const t = useTranslations('settings');
  const [isPrivate, setIsPrivate] = useState(initialIsPrivate);
  const [saving, setSaving] = useState(false);

  async function toggle() {
    const next = !isPrivate;
    setIsPrivate(next);
    setSaving(true);
    try {
      const res = await fetch('/api/settings/privacy', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isPrivate: next }),
      });
      if (!res.ok) throw new Error();
      pushToast('success', t('saved'));
    } catch {
      setIsPrivate(!next);
      pushToast('error', t('save_failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-start justify-between gap-6">
      <div>
        <h3 className="text-sm font-medium">{t('privacy_toggle_label')}</h3>
        <p className="mt-1 max-w-lg text-xs leading-relaxed text-muted">{t('privacy_toggle_desc')}</p>
      </div>
      <button
        role="switch"
        aria-checked={isPrivate}
        disabled={saving}
        onClick={toggle}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${
          isPrivate ? 'bg-zinc-900 dark:bg-zinc-100' : 'bg-zinc-300 dark:bg-zinc-700'
        } disabled:opacity-60`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
            isPrivate ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
}
