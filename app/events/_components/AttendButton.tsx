'use client';

// 我要参加 toggle (detail page). Joining doubles as the opt-in for the
// 开始前 ~30 分钟 reminder (email + in-app). Optimistic-ish: trusts the
// route's authoritative re-read, then router.refresh() so the card border /
// counts elsewhere follow.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CalendarCheck2, CalendarPlus, Loader2, Users } from 'lucide-react';
import { pushToast } from '@/components/Toaster';

export function AttendButton({
  id,
  attending,
  attendeeCount,
}: {
  id: string;
  attending: boolean;
  attendeeCount: number;
}) {
  const t = useTranslations('events');
  const router = useRouter();
  const [state, setState] = useState({ attending, count: attendeeCount });
  const [busy, setBusy] = useState(false);

  useEffect(() => setState({ attending, count: attendeeCount }), [attending, attendeeCount]);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/events/${id}/attend`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        pushToast('error', data.reason ?? t('attend_failed'));
        return;
      }
      setState({ attending: Boolean(data.attending), count: data.attendeeCount ?? 0 });
      pushToast('success', data.attending ? t('toast_joined') : t('toast_left'));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className={
          state.attending
            ? 'flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-accent-500 bg-accent-500/10 text-sm font-medium text-accent-600 transition hover:bg-accent-500/20 disabled:opacity-60 dark:text-accent-400'
            : 'flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-accent-500 text-sm font-medium text-white transition hover:bg-accent-600 disabled:opacity-60'
        }
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : state.attending ? (
          <CalendarCheck2 className="h-4 w-4" />
        ) : (
          <CalendarPlus className="h-4 w-4" />
        )}
        {state.attending ? t('attend_joined') : t('attend_join')}
      </button>
      <p className="mt-1.5 flex items-center justify-center gap-1 text-xs text-muted">
        <Users className="h-3.5 w-3.5" />
        {t('attendee_count', { count: state.count })}
      </p>
      {!state.attending && <p className="mt-1 text-center text-[11px] text-muted">{t('attend_reminder_hint')}</p>}
    </div>
  );
}
