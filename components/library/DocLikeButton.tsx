'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Heart } from 'lucide-react';
import { pushToast } from '@/components/Toaster';

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
  const router = useRouter();
  const pathname = usePathname();
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
        pushToast('error', '请先登录');
        router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'failed');
      setLiked(Boolean(data.liked));
      if (typeof data.likeCount === 'number') setCount(data.likeCount);
    } catch {
      setLiked(prev.liked);
      setCount(prev.count);
      pushToast('error', '操作失败，请重试');
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
          ? 'border-accent-500 bg-accent-500/10 text-accent-600 dark:text-accent-300'
          : 'border-zinc-200 hover:border-accent-500 hover:text-accent-600 dark:border-zinc-700'
      }`}
    >
      <Heart className={`h-4 w-4 ${liked ? 'fill-current' : ''}`} />
      {liked ? '已喜欢' : '喜欢'}
      <span className="font-mono text-xs tabular-nums">{count}</span>
    </button>
  );
}
