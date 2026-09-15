'use client';

// 隐私账号 — saves on toggle (a single boolean has nothing to batch), rolls back on failure.
// It changes what a hover card shows (@handle, 部门), so a saved flip drops this
// tab's cached card of the member.

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';
import { invalidateUserCard } from '@/components/user/UserHoverCard';
import { Switch } from '../_components/Switch';

export function PrivacyForm({ initialIsPrivate, handle }: { initialIsPrivate: boolean; handle: string }) {
  const t = useTranslations('settings');
  const [isPrivate, setIsPrivate] = useState(initialIsPrivate);
  const [saving, setSaving] = useState(false);

  async function toggle(next: boolean) {
    if (saving) return;
    setIsPrivate(next);
    setSaving(true);
    try {
      const res = await fetch('/api/settings/privacy', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isPrivate: next }),
      });
      if (!res.ok) throw new Error();
      invalidateUserCard(handle);
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
        <h3 id="privacy-account-title" className="text-sm font-semibold tracking-tight">
          {t('privacy_toggle_label')}
        </h3>
        <p id="privacy-account-desc" className="mt-1 max-w-lg text-xs leading-relaxed text-muted">
          {t('privacy_toggle_desc')}
        </p>
      </div>
      <Switch
        checked={isPrivate}
        onChange={(v) => void toggle(v)}
        busy={saving}
        labelledBy="privacy-account-title"
        describedBy="privacy-account-desc"
        className="mt-0.5"
      />
    </div>
  );
}
