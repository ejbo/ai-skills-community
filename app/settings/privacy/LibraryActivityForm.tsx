'use client';

// 知识库阅读动态 privacy toggle — whether you appear in docs' 正在阅读 rosters.

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';
import { Switch } from '../_components/Switch';

export function LibraryActivityForm({ initialShow }: { initialShow: boolean }) {
  const t = useTranslations('settings');
  const [show, setShow] = useState(initialShow);
  const [saving, setSaving] = useState(false);

  async function toggle(next: boolean) {
    if (saving) return;
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
        <h3 id="library-activity-title" className="text-sm font-semibold tracking-tight">
          {t('library_activity_title')}
        </h3>
        <p id="library-activity-desc" className="mt-1 max-w-lg text-xs leading-relaxed text-muted">
          {t('library_activity_desc')}
        </p>
      </div>
      <Switch
        checked={show}
        onChange={(v) => void toggle(v)}
        busy={saving}
        labelledBy="library-activity-title"
        describedBy="library-activity-desc"
        className="mt-0.5"
      />
    </div>
  );
}
