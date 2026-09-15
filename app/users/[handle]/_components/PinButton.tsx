'use client';

// 置顶到主页精选 — the owner's pin toggle on a section item. Optimistic: the
// icon flips at once, the server answers with the authoritative list, and a
// refusal (精选已满 / no longer pinnable) rolls the icon back with a toast.
// `router.refresh()` afterwards re-renders the 概览 band from the server, which
// re-gates every pin — the client never renders a pin card itself.

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Pin, PinOff } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { MAX_PINS, type PinKind } from '@/lib/profile/shared';

export function PinButton({
  kind,
  id,
  pinned: initialPinned,
  className = '',
}: {
  kind: PinKind;
  id: string;
  pinned: boolean;
  className?: string;
}) {
  const t = useTranslations('profile');
  const router = useRouter();
  const [pinned, setPinned] = useState(initialPinned);
  const [busy, setBusy] = useState(false);
  const flight = useRef(false);

  async function toggle() {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    const next = !pinned;
    setPinned(next);
    try {
      const res = await fetch('/api/me/profile/pins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, id, pinned: next }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setPinned(!next);
        pushToast(
          'error',
          data?.error === 'pins_full'
            ? t('pin_full', { max: MAX_PINS })
            : data?.error === 'not_found'
              ? t('pin_not_found')
              : data?.error === 'rate_limited'
                ? t('pin_rate_limited')
                : t('pin_failed'),
        );
        return;
      }
      pushToast('success', next ? t('pin_pinned') : t('pin_unpinned'));
      router.refresh();
    } catch {
      setPinned(!next);
      pushToast('error', t('pin_failed'));
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }

  const label = pinned ? t('pin_unpin') : t('pin_pin');
  const Icon = pinned ? PinOff : Pin;
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={pinned}
      aria-label={label}
      title={label}
      className={`group/pinbtn flex h-8 w-8 items-center justify-center rounded-full shadow-sm ring-1 transition disabled:cursor-wait ${
        pinned
          ? 'bg-zinc-900 text-white ring-zinc-900 hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:ring-zinc-100 dark:hover:bg-white'
          : 'bg-white text-zinc-600 ring-zinc-200 hover:text-zinc-900 hover:ring-zinc-400 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:text-zinc-50 dark:hover:ring-zinc-500'
      } ${className}`}
    >
      {/* Pinned shows the solid pin; hovering it previews the unpin action. */}
      {pinned ? (
        <>
          <Pin className="h-3.5 w-3.5 group-hover/pinbtn:hidden" fill="currentColor" aria-hidden />
          <Icon className="hidden h-3.5 w-3.5 group-hover/pinbtn:block" aria-hidden />
        </>
      ) : (
        <Icon className="h-3.5 w-3.5" aria-hidden />
      )}
    </button>
  );
}
