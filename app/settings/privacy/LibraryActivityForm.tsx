'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';

/** 知识库阅读动态 privacy toggle — whether you appear in docs' 正在阅读 rosters. */
export function LibraryActivityForm({ initialShow }: { initialShow: boolean }) {
  const t = useTranslations('settings');
  const [show, setShow] = useState(initialShow);
  const [saving, setSaving] = useState(false);

  async function toggle() {
    const next = !show;
    setShow(next);
    setSaving(true);
    try {
      const res = await fetch('/api/settings/privacy', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ showLibraryActivity: next }),
      });
      if (!res.ok) throw new Error();
      pushToast('success', t('saved'));
    } catch {
      setShow(!next);
      pushToast('error', t('save_failed_retry'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-start justify-between gap-6">
      <div>
        <h3 className="text-sm font-medium">{t('library_activity_title')}</h3>
        <p className="mt-1 max-w-lg text-xs leading-relaxed text-muted">
          {t('library_activity_desc')}
        </p>
      </div>
      <button
        role="switch"
        aria-checked={show}
        disabled={saving}
        onClick={toggle}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${
          show ? 'bg-accent-500' : 'bg-zinc-300 dark:bg-zinc-700'
        } disabled:opacity-60`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
            show ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
}
