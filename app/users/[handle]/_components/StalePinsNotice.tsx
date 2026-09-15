'use client';

// 失效精选 — the owner's way out for pins whose item died (deleted, no longer
// public, still re-processing). Such a pin renders nowhere and no section list
// carries a PinButton for it, yet it still takes one of the MAX_PINS slots.
// 清理 asks the SERVER to prune (POST {prune:true}): it re-checks every stored
// pin, so an item that came back to life between render and click keeps its
// place. `router.refresh()` then re-renders the band and its N/6 counter.

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, PinOff } from 'lucide-react';
import { pushToast } from '@/components/Toaster';

export function StalePinsNotice({ count }: { count: number }) {
  const t = useTranslations('profile');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const flight = useRef(false);

  async function prune() {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    try {
      const res = await fetch('/api/me/profile/pins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prune: true }),
      });
      const data = (await res.json().catch(() => null)) as { removed?: number; error?: string } | null;
      if (!res.ok) {
        pushToast('error', data?.error === 'rate_limited' ? t('pin_rate_limited') : t('pin_failed'));
        return;
      }
      const removed = data?.removed ?? 0;
      pushToast('success', removed > 0 ? t('pin_stale_cleaned', { count: removed }) : t('pin_stale_none'));
      router.refresh();
    } catch {
      pushToast('error', t('pin_failed'));
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-dashed border-zinc-300 px-4 py-2.5 dark:border-zinc-700"
    >
      <PinOff className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{t('pin_stale_notice', { count })}</p>
        <p className="mt-0.5 text-xs text-muted">{t('pin_stale_hint')}</p>
      </div>
      <button
        type="button"
        onClick={prune}
        disabled={busy}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs font-medium text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-zinc-50 dark:focus-visible:ring-zinc-100"
      >
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
        {t('pin_stale_clean')}
      </button>
    </div>
  );
}
