'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BookmarkCheck, BookmarkPlus } from 'lucide-react';
import { pushToast } from '@/components/Toaster';

/** 加入书架 / 已在书架 — 乐观切换，服务端计数回填，出错回滚。 */
export function ShelfButton({
  docId,
  initialShelved,
  initialCount,
}: {
  docId: string;
  initialShelved: boolean;
  initialCount: number;
}) {
  const t = useTranslations('library_cards');
  const tv = useTranslations('video');
  const tf = useTranslations('feedback');
  const router = useRouter();
  const pathname = usePathname();
  const [shelved, setShelved] = useState(initialShelved);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    const prev = { shelved, count };
    setShelved(!shelved);
    setCount(count + (shelved ? -1 : 1));
    try {
      const res = await fetch(`/api/library/docs/${docId}/shelf`, {
        method: prev.shelved ? 'DELETE' : 'POST',
      });
      if (res.status === 401) {
        setShelved(prev.shelved);
        setCount(prev.count);
        pushToast('error', tv('login_required'));
        router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'failed');
      setShelved(Boolean(data.shelved));
      if (typeof data.shelfCount === 'number') setCount(data.shelfCount);
    } catch {
      setShelved(prev.shelved);
      setCount(prev.count);
      pushToast('error', tf('action_failed_retry'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-pressed={shelved}
      className={`flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border px-4 text-sm font-medium transition disabled:opacity-60 ${
        shelved
          ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-900/[0.06] dark:bg-white/10 text-zinc-900 dark:text-zinc-50'
          : 'border-zinc-200 hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-700'
      }`}
    >
      {shelved ? <BookmarkCheck className="h-4 w-4" /> : <BookmarkPlus className="h-4 w-4" />}
      {shelved ? t('on_shelf') : t('add_to_shelf')}
      <span className="font-mono text-xs tabular-nums">{count}</span>
    </button>
  );
}
