'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronUp } from 'lucide-react';
import { pushToast } from '@/components/Toaster';

/**
 * GitHub-style +1. Optimistic flip, reconciled with the server's authoritative
 * count; rolled back on error. `size="lg"` is the detail-page variant.
 */
export function UpvoteButton({
  feedbackId,
  initialCount,
  initialUpvoted,
  size = 'sm',
}: {
  feedbackId: string;
  initialCount: number;
  initialUpvoted: boolean;
  size?: 'sm' | 'lg';
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [count, setCount] = useState(initialCount);
  const [upvoted, setUpvoted] = useState(initialUpvoted);
  const [busy, setBusy] = useState(false);

  async function toggle(e: React.MouseEvent) {
    // Defensive: keep the click strictly on the button even if a future layout
    // nests it inside a link/row handler again.
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    const prev = { count, upvoted };
    setUpvoted(!upvoted);
    setCount(count + (upvoted ? -1 : 1));
    try {
      const res = await fetch(`/api/feedback/${feedbackId}/upvote`, { method: 'POST' });
      if (res.status === 401) {
        setCount(prev.count);
        setUpvoted(prev.upvoted);
        pushToast('error', '请先登录再 +1');
        router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'failed');
      setUpvoted(Boolean(data.upvoted));
      setCount(typeof data.upvoteCount === 'number' ? data.upvoteCount : prev.count);
    } catch {
      setCount(prev.count);
      setUpvoted(prev.upvoted);
      pushToast('error', '操作失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  const base =
    'flex flex-col items-center justify-center rounded-lg border font-mono tabular-nums transition disabled:opacity-60';
  const tone = upvoted
    ? 'border-accent-500 bg-accent-500/10 text-accent-600 dark:text-accent-300'
    : 'border-zinc-200 text-zinc-500 hover:border-accent-500 hover:text-accent-600 dark:border-zinc-700 dark:text-zinc-400';
  const dims = size === 'lg' ? 'h-14 w-12 text-sm' : 'h-11 w-10 text-xs';

  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-pressed={upvoted}
      title={upvoted ? '取消 +1' : '+1 支持这条反馈'}
      className={`${base} ${tone} ${dims}`}
    >
      <ChevronUp className={size === 'lg' ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
      {count}
    </button>
  );
}
