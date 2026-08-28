'use client';

// Compact 参加 toggle for list cards. Sits above the card's stretched link
// (relative z-10). Anonymous clicks get the house 401 treatment (toast +
// login redirect) — the button is always rendered on joinable cards so the
// list works without knowing the session.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CalendarCheck2, CalendarPlus, Loader2 } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { currentLoginHref } from '@/lib/auth/callback-path';

export function CardAttendButton({ id, attending }: { id: string; attending: boolean }) {
  const t = useTranslations('events');
  const router = useRouter();
  const [isAttending, setIsAttending] = useState(attending);
  const [busy, setBusy] = useState(false);

  useEffect(() => setIsAttending(attending), [attending]);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/events/${id}/attend`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        pushToast('error', t('attend_login'));
        router.push(currentLoginHref());
        return;
      }
      if (!res.ok) {
        pushToast('error', data.reason ?? t('attend_failed'));
        return;
      }
      setIsAttending(Boolean(data.attending));
      pushToast('success', data.attending ? t('toast_joined') : t('toast_left'));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={`relative z-10 ml-auto inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition disabled:opacity-60 ${
        isAttending
          ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300'
          : 'border border-zinc-900/40 dark:border-zinc-100/40 bg-zinc-900/[0.06] dark:bg-white/10 text-zinc-900 dark:text-zinc-50 hover:bg-zinc-900/10 dark:hover:bg-white/[0.14]'
      }`}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : isAttending ? (
        <CalendarCheck2 className="h-3.5 w-3.5" />
      ) : (
        <CalendarPlus className="h-3.5 w-3.5" />
      )}
      {isAttending ? t('attending_badge') : t('attend_short')}
    </button>
  );
}
