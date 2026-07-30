'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Star } from 'lucide-react';
import { pushToast } from '@/components/Toaster';

/** 评分 — average display + the viewer's own 1-5 star input (click again to clear). */
export function RatingStars({
  docId,
  initialAvg,
  initialCount,
  initialMine,
  canRate,
}: {
  docId: string;
  initialAvg: number;
  initialCount: number;
  initialMine: number;
  canRate: boolean;
}) {
  const t = useTranslations('library_cards');
  const tv = useTranslations('video');
  const router = useRouter();
  const pathname = usePathname();
  const [avg, setAvg] = useState(initialAvg);
  const [count, setCount] = useState(initialCount);
  const [mine, setMine] = useState(initialMine);
  const [hover, setHover] = useState(0);
  const [busy, setBusy] = useState(false);

  async function rate(value: number) {
    if (busy) return;
    if (!canRate) {
      pushToast('error', tv('login_required'));
      router.push(`/auth/login?callbackUrl=${encodeURIComponent(pathname)}`);
      return;
    }
    setBusy(true);
    const clearing = value === mine;
    try {
      const res = await fetch(`/api/library/docs/${docId}/rating`, {
        method: clearing ? 'DELETE' : 'PUT',
        ...(clearing
          ? {}
          : {
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ rating: value }),
            }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'failed');
      setMine(data.myRating ?? 0);
      if (typeof data.avgRating === 'number') setAvg(data.avgRating);
      if (typeof data.ratingCount === 'number') setCount(data.ratingCount);
      pushToast('success', clearing ? t('rating_cleared') : t('rating_thanks'));
    } catch {
      pushToast('error', t('rating_failed'));
    } finally {
      setBusy(false);
    }
  }

  const display = hover || mine;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="radiogroup"
        aria-label={t('rate_this')}
        className="flex items-center"
        onMouseLeave={() => setHover(0)}
      >
        {[1, 2, 3, 4, 5].map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={mine === v}
            aria-label={t('star_label', { count: v })}
            disabled={busy}
            onMouseEnter={() => setHover(v)}
            onClick={() => void rate(v)}
            className="p-0.5 transition hover:scale-110 disabled:opacity-60"
          >
            <Star
              className={`h-5 w-5 transition-colors ${
                v <= display
                  ? 'fill-amber-400 text-amber-400'
                  : 'text-zinc-300 dark:text-zinc-600'
              }`}
            />
          </button>
        ))}
      </div>
      <span className="text-sm text-muted">
        {count > 0 ? (
          <>
            <span className="font-mono font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
              {avg.toFixed(1)}
            </span>{' '}
            · {t('rating_count', { count })}
          </>
        ) : (
          t('no_ratings')
        )}
        {mine > 0 && <span className="ml-1.5">{t('my_rating', { count: mine })}</span>}
      </span>
    </div>
  );
}
