'use client';

// 名片 loading placeholder, with the card's footprint (holo/minimal aspect — the
// common case).
//
// Deliberately free of ./profile-card.css: the hover card shows this BEFORE its
// lazily imported card chunk (and that chunk's stylesheet) has arrived, and
// Avatar → UserHoverCard sits in the root layout through the navbar — a static
// import of the stylesheet here would put the whole card CSS back on every
// route, /auth/login included. Tailwind + inline geometry only.

import { useTranslations } from 'next-intl';
import { CARD_ASPECT, CARD_WIDTH, type ProfileCardSize } from '@/components/profile-card/card-shared';

export function ProfileCardSkeleton({ size = 'md', className = '' }: { size?: ProfileCardSize; className?: string }) {
  const t = useTranslations('profile');
  const width = CARD_WIDTH[size];
  return (
    <div
      role="status"
      aria-label={t('hover_loading')}
      className={`surface relative max-w-full overflow-hidden ${className}`}
      style={{ width, aspectRatio: String(CARD_ASPECT.holo), borderRadius: Math.round(width * 0.08) }}
    >
      <div className="shimmer absolute inset-x-0 top-0 h-[42%]" />
      <div className="absolute inset-x-0 bottom-0 top-[42%] flex flex-col gap-2.5 p-5">
        <div className="shimmer -mt-12 h-16 w-16 rounded-full ring-4 ring-[rgb(var(--surface))]" />
        <div className="shimmer mt-1 h-4 w-2/5 rounded" />
        <div className="shimmer h-3 w-1/4 rounded" />
        <div className="shimmer mt-1 h-3 w-4/5 rounded" />
        <div className="shimmer h-3 w-3/5 rounded" />
        <div className="mt-auto flex gap-3">
          <div className="shimmer h-3 w-12 rounded" />
          <div className="shimmer h-3 w-12 rounded" />
          <div className="shimmer h-3 w-12 rounded" />
        </div>
      </div>
    </div>
  );
}
