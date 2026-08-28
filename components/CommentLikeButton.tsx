'use client';

// One like button for every comment thread in the app.
//
// The optimistic-toggle-then-reconcile dance was already copy-pasted across the
// video, 动态 and 技术专区 comment components, and the request added five more
// threads (论坛回复 / 意见反馈 / 知识库评论 / 批注回复 / 作品评论). Eight copies of
// the same 35 lines is how the surfaces drift, so the behaviour lives here:
//
//   • paint the new state immediately, then take the SERVER's numbers — every
//     like route answers with an authoritative re-read, so a lost race
//     self-heals on the next click instead of leaving a wrong count on screen;
//   • roll back the optimistic paint on any failure;
//   • a signed-out click is not an error — it is a login redirect that returns
//     to the page the reader was on;
//   • one in-flight request at a time (`busy`), so double-clicks cannot
//     interleave a create and a delete.
//
// Callers own only the endpoint and the initial state. `size="xs"` matches the
// 11px meta rows (feedback, 作品评论), the default matches the 13px ones.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Heart } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';
import { currentLoginHref } from '@/lib/auth/callback-path';

export function CommentLikeButton({
  endpoint,
  initialLiked,
  initialCount,
  signedIn,
  disabled = false,
  size = 'sm',
  tone = 'default',
  className = '',
}: {
  /** POST target that toggles the like and returns `{ liked, likeCount }`. */
  endpoint: string;
  initialLiked: boolean;
  initialCount: number;
  signedIn: boolean;
  /** Tombstoned/deleted rows keep the count visible but refuse the toggle. */
  disabled?: boolean;
  size?: 'xs' | 'sm';
  /**
   * `reader` swaps zinc for the 知识库 reader's own tokens — inside `.reader-root`
   * the palette follows the READER theme (浅色/护眼/深色), which is independent of
   * the site theme, so a `dark:` variant there is wrong half the time.
   * `onDark` is for panels that are always dark whatever the site theme (the
   * 投票 lightbox), where `dark:` variants never fire at all.
   */
  tone?: 'default' | 'reader' | 'onDark';
  className?: string;
}) {
  const t = useTranslations('common');
  const router = useRouter();
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy || disabled) return;
    if (!signedIn) {
      pushToast('error', t('login_required'));
      router.push(currentLoginHref());
      return;
    }
    setBusy(true);
    const prev = { liked, count };
    setLiked(!liked);
    setCount(Math.max(0, count + (liked ? -1 : 1)));
    try {
      const res = await fetch(endpoint, { method: 'POST' });
      if (res.status === 401) {
        setLiked(prev.liked);
        setCount(prev.count);
        pushToast('error', t('login_required'));
        router.push(currentLoginHref());
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { liked?: boolean; likeCount?: number };
      if (!res.ok) throw new Error('failed');
      setLiked(Boolean(data.liked));
      setCount(typeof data.likeCount === 'number' ? Math.max(0, data.likeCount) : prev.count);
    } catch {
      setLiked(prev.liked);
      setCount(prev.count);
      pushToast('error', t('action_failed'));
    } finally {
      setBusy(false);
    }
  }

  const icon = size === 'xs' ? 'h-3 w-3' : 'h-3.5 w-3.5';
  const colors =
    tone === 'reader'
      ? liked
        ? 'font-medium text-[var(--reader-fg)]'
        : 'r-muted hover:text-[var(--reader-accent)]'
      : tone === 'onDark'
        ? liked
          ? 'font-medium text-white'
          : 'text-white/60 hover:text-white/90'
        : liked
          ? 'font-medium text-zinc-900 dark:text-zinc-50'
          : 'hover:text-zinc-700 dark:hover:text-zinc-200';
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy || disabled}
      aria-pressed={liked}
      aria-label={t('like')}
      className={`inline-flex items-center gap-1 transition disabled:opacity-60 ${colors} ${className}`}
    >
      <Heart className={`${icon} ${liked ? 'fill-current' : ''}`} aria-hidden />
      {/* The label stands in for a zero so the control never reads as "0 likes". */}
      <span className="font-mono tabular-nums">{count > 0 ? count : t('like')}</span>
    </button>
  );
}
