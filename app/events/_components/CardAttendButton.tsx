'use client';

// Compact 参加 toggle for list cards. Sits above the card's stretched link
// (relative z-10). Anonymous clicks get the house 401 treatment (toast +
// login redirect) — the button is always rendered on joinable cards so the
// list works without knowing the session.

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CalendarCheck2, CalendarPlus, Loader2 } from 'lucide-react';
import { pushToast } from '@/components/Toaster';

export function CardAttendButton({ id, attending }: { id: string; attending: boolean }) {
  const t = useTranslations('events');
  const router = useRouter();
  const pathname = usePathname();
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
        router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
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
          ? 'bg-accent-500 text-white hover:bg-accent-600'
          : 'border border-accent-500/60 bg-accent-500/10 text-accent-600 hover:bg-accent-500/20 dark:text-accent-400'
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
