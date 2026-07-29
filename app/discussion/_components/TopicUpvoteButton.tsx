'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronUp } from 'lucide-react';
import { pushToast } from '@/components/Toaster';

/** Optimistic +1 toggle for forum topics — same contract as the feedback board's UpvoteButton. */
export function TopicUpvoteButton({
  topicId,
  initialCount,
  initialUpvoted,
  size = 'sm',
}: {
  topicId: string;
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
      const res = await fetch(`/api/discussion/topics/${topicId}/upvote`, { method: 'POST' });
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

  const dims = size === 'lg' ? 'h-14 w-12 text-sm' : 'h-11 w-10 text-xs';

  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-pressed={upvoted}
      title={upvoted ? '取消 +1' : '+1'}
      className={`flex shrink-0 flex-col items-center justify-center rounded-lg border transition ${dims} ${
        upvoted
          ? 'border-accent-500 bg-accent-500/10 font-medium text-accent-600 dark:text-accent-300'
          : 'border-zinc-200 text-zinc-600 hover:border-accent-400 hover:text-accent-600 dark:border-zinc-800 dark:text-zinc-300 dark:hover:text-accent-300'
      }`}
    >
      <ChevronUp className="h-4 w-4" />
      <span className="tabular-nums">{count}</span>
    </button>
  );
}
