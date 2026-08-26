'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';

export interface PrefValues {
  inAppCommentReply: boolean;
  inAppAccessRequest: boolean;
  inAppAccessDecision: boolean;
  inAppAnnouncement: boolean;
  emailCommentReply: boolean;
  emailAccessRequest: boolean;
  emailAccessDecision: boolean;
  emailAnnouncement: boolean;
}

// One row per notification category; each has an in-app key and an email key.
const ROWS: { labelKey: string; hintKey: string; inApp: keyof PrefValues; email: keyof PrefValues }[] = [
  {
    labelKey: 'notif_type_comment_reply',
    hintKey: 'notif_hint_comment_reply',
    inApp: 'inAppCommentReply',
    email: 'emailCommentReply',
  },
  {
    labelKey: 'notif_type_access_request',
    hintKey: 'notif_hint_access_request',
    inApp: 'inAppAccessRequest',
    email: 'emailAccessRequest',
  },
  {
    labelKey: 'notif_type_access_decision',
    hintKey: 'notif_hint_access_decision',
    inApp: 'inAppAccessDecision',
    email: 'emailAccessDecision',
  },
  {
    labelKey: 'notif_type_announcement',
    hintKey: 'notif_hint_announcement',
    inApp: 'inAppAnnouncement',
    email: 'emailAnnouncement',
  },
];

export function NotificationPreferenceForm({ initial }: { initial: PrefValues }) {
  const t = useTranslations('settings');
  const [values, setValues] = useState<PrefValues>(initial);
  const [pending, startTransition] = useTransition();

  function toggle(key: keyof PrefValues) {
    setValues((v) => ({ ...v, [key]: !v[key] }));
  }

  function save() {
    startTransition(async () => {
      try {
        const res = await fetch('/api/settings/notification-preferences', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(values),
        });
        if (!res.ok) throw new Error();
        pushToast('success', t('saved'));
      } catch {
        pushToast('error', t('save_failed_retry_later'));
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="surface overflow-hidden rounded-2xl">
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 border-b border-zinc-100 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted dark:border-zinc-800">
          <span>{t('notif_col_type')}</span>
          <span className="w-14 text-center">{t('notif_col_in_app')}</span>
          <span className="w-14 text-center">{t('notif_col_email')}</span>
        </div>
        {ROWS.map((row) => (
          <div
            key={row.inApp}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 border-b border-zinc-100 px-4 py-3 last:border-b-0 dark:border-zinc-800"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium">{t(row.labelKey)}</div>
              <div className="text-xs text-muted">{t(row.hintKey)}</div>
            </div>
            <div className="flex w-14 justify-center">
              <Toggle checked={values[row.inApp]} onChange={() => toggle(row.inApp)} />
            </div>
            <div className="flex w-14 justify-center">
              <Toggle checked={values[row.email]} onChange={() => toggle(row.email)} />
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={save}
        disabled={pending}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-4 text-sm font-medium text-white dark:text-zinc-900 transition hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-60"
      >
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {t('save')}
      </button>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative h-5 w-9 shrink-0 rounded-full transition ${
        checked ? 'bg-zinc-900 dark:bg-zinc-100' : 'bg-zinc-300 dark:bg-zinc-700'
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
          checked ? 'left-[18px]' : 'left-0.5'
        }`}
      />
    </button>
  );
}
