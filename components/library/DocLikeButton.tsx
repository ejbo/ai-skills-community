'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Heart } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import { currentLoginHref } from '@/lib/auth/callback-path';

/** 喜欢 / 已喜欢 — 与 ShelfButton 相同的乐观切换模式。 */
export function DocLikeButton({
  docId,
  initialLiked,
  initialCount,
}: {
  docId: string;
  initialLiked: boolean;
  initialCount: number;
}) {
  const t = useTranslations('library_cards');
  const tv = useTranslations('video');
  const tf = useTranslations('feedback');
  const router = useRouter();
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    const prev = { liked, count };
    setLiked(!liked);
    setCount(count + (liked ? -1 : 1));
    try {
      const res = await fetch(`/api/library/docs/${docId}/like`, {
        method: prev.liked ? 'DELETE' : 'POST',
      });
      if (res.status === 401) {
        setLiked(prev.liked);
        setCount(prev.count);
        pushToast('error', tv('login_required'));
        router.push(currentLoginHref());
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'failed');
      setLiked(Boolean(data.liked));
      if (typeof data.likeCount === 'number') setCount(data.likeCount);
    } catch {
      setLiked(prev.liked);
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
      aria-pressed={liked}
      className={`flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border px-4 text-sm font-medium transition disabled:opacity-60 ${
        liked
          ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-900/[0.06] dark:bg-white/10 text-zinc-900 dark:text-zinc-50'
          : 'border-zinc-200 hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-700'
      }`}
    >
      <Heart className={`h-4 w-4 ${liked ? 'fill-current' : ''}`} />
      {liked ? t('liked') : t('like')}
      <span className="font-mono text-xs tabular-nums">{count}</span>
    </button>
  );
}
