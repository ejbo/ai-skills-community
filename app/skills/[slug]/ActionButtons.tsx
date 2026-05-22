'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Bell, BellRing, Heart, Star, GitFork } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';

interface Props {
  slug: string;
  initiallyLiked: boolean;
  initiallyFavorited: boolean;
  initiallySubscribed: boolean;
  likeCount: number;
  subscriberCount: number;
  canRemix: boolean;
}

export function ActionButtons(props: Props) {
  const t = useTranslations('detail');
  const router = useRouter();
  const [liked, setLiked] = useState(props.initiallyLiked);
  const [fav, setFav] = useState(props.initiallyFavorited);
  const [sub, setSub] = useState(props.initiallySubscribed);
  const [likeCount, setLikeCount] = useState(props.likeCount);
  const [subCount, setSubCount] = useState(props.subscriberCount);
  const [, startTransition] = useTransition();

  async function toggle(
    kind: 'like' | 'favorite' | 'subscribe',
    setLocal: (v: boolean) => void,
    current: boolean,
    countSetter?: (n: number) => void,
    currentCount?: number,
  ) {
    setLocal(!current);
    if (countSetter && typeof currentCount === 'number') {
      countSetter(current ? Math.max(0, currentCount - 1) : currentCount + 1);
    }
    const res = await fetch(`/api/skills/${props.slug}/${kind}`, { method: 'POST' });
    if (!res.ok) {
      // rollback
      setLocal(current);
      if (countSetter && typeof currentCount === 'number') countSetter(currentCount);
      if (res.status === 401) {
        pushToast('info', '请先登录');
        router.push(`/auth/login?callbackUrl=/skills/${props.slug}`);
      } else {
        pushToast('error', '操作失败，请稍后再试');
      }
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={() => toggle('subscribe', setSub, sub, setSubCount, subCount)}
        className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition ${
          sub
            ? 'border-accent-500 bg-accent-500/10 text-accent-700 dark:text-accent-300'
            : 'border-zinc-300 hover:border-zinc-400 dark:border-zinc-700'
        }`}
      >
        {sub ? <BellRing className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
        {sub ? t('subscribed') : t('subscribe')}
        <span className="font-mono tabular-nums text-xs text-muted">{subCount}</span>
      </button>

      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={() => toggle('like', setLiked, liked, setLikeCount, likeCount)}
        className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition ${
          liked
            ? 'border-danger/40 bg-danger/10 text-danger'
            : 'border-zinc-300 hover:border-zinc-400 dark:border-zinc-700'
        }`}
      >
        <Heart className="h-3.5 w-3.5" fill={liked ? 'currentColor' : 'none'} />
        {t('like')}
        <span className="font-mono tabular-nums text-xs text-muted">{likeCount}</span>
      </motion.button>

      <button
        onClick={() => toggle('favorite', setFav, fav)}
        className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition ${
          fav
            ? 'border-warn/40 bg-warn/10 text-warn'
            : 'border-zinc-300 hover:border-zinc-400 dark:border-zinc-700'
        }`}
      >
        <Star className="h-3.5 w-3.5" fill={fav ? 'currentColor' : 'none'} />
        {t('favorite')}
      </button>

      {props.canRemix && (
        <button
          onClick={() =>
            startTransition(() => router.push(`/skills/${props.slug}/remix`))
          }
          className="flex h-9 items-center gap-1.5 rounded-lg border border-zinc-300 px-3 text-sm font-medium transition hover:border-zinc-400 dark:border-zinc-700"
        >
          <GitFork className="h-3.5 w-3.5" />
          {t('remix')}
        </button>
      )}
    </div>
  );
}
