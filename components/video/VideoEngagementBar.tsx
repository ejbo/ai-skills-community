'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Heart, Star, Share2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';
import { formatCount } from '@/lib/video/types';

interface Props {
  slug: string;
  likeCount: number;
  favoriteCount: number;
  initialLiked: boolean;
  initialFavorited: boolean;
}

export function VideoEngagementBar(props: Props) {
  const t = useTranslations('video');
  const router = useRouter();
  const [liked, setLiked] = useState(props.initialLiked);
  const [favorited, setFavorited] = useState(props.initialFavorited);
  const [likeCount, setLikeCount] = useState(props.likeCount);
  const [favoriteCount, setFavoriteCount] = useState(props.favoriteCount);

  async function toggle(
    kind: 'like' | 'favorite',
    current: boolean,
    setLocal: (v: boolean) => void,
    count: number,
    setCount: (n: number) => void,
  ) {
    // Optimistic flip.
    setLocal(!current);
    setCount(current ? Math.max(0, count - 1) : count + 1);

    try {
      const res = await fetch(`/api/videos/${props.slug}/${kind}`, { method: 'POST' });
      if (!res.ok) throw res;
      const data = await res.json();
      // Reconcile with server truth.
      if (kind === 'like') {
        setLocal(Boolean(data.liked));
        setCount(typeof data.likeCount === 'number' ? data.likeCount : count);
      } else {
        setLocal(Boolean(data.favorited));
        setCount(typeof data.favoriteCount === 'number' ? data.favoriteCount : count);
      }
    } catch (err) {
      // Roll back the optimistic update.
      setLocal(current);
      setCount(count);
      if (err instanceof Response && err.status === 401) {
        pushToast('info', t('login_required'));
        router.push('/auth/login');
      } else {
        pushToast('error', '操作失败，请稍后再试');
      }
    }
  }

  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      pushToast('success', t('detail.copied'));
    } catch {
      pushToast('error', '复制失败');
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={() => toggle('like', liked, setLiked, likeCount, setLikeCount)}
        className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition ${
          liked
            ? 'border-danger/40 bg-danger/10 text-danger'
            : 'border-zinc-300 hover:border-zinc-400 dark:border-zinc-700'
        }`}
      >
        <Heart className="h-3.5 w-3.5" fill={liked ? 'currentColor' : 'none'} />
        {t('detail.like')}
        <span className="font-mono tabular-nums text-xs text-muted">{formatCount(likeCount)}</span>
      </motion.button>

      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={() => toggle('favorite', favorited, setFavorited, favoriteCount, setFavoriteCount)}
        className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition ${
          favorited
            ? 'border-warn/40 bg-warn/10 text-warn'
            : 'border-zinc-300 hover:border-zinc-400 dark:border-zinc-700'
        }`}
      >
        <Star className="h-3.5 w-3.5" fill={favorited ? 'currentColor' : 'none'} />
        {t('detail.favorite')}
        <span className="font-mono tabular-nums text-xs text-muted">{formatCount(favoriteCount)}</span>
      </motion.button>

      <button
        onClick={share}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-zinc-300 px-3 text-sm font-medium transition hover:border-zinc-400 dark:border-zinc-700"
      >
        <Share2 className="h-3.5 w-3.5" />
        {t('detail.share')}
      </button>
    </div>
  );
}
