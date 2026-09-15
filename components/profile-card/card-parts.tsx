'use client';

// 名片 — the React pieces the three styles share: the root CSS variables, the
// joined line, the mini avatar, the stat figures. Pure helpers live in
// ./card-shared (a module mixing components with plain functions defeats
// Fast Refresh and full-reloads the page on every edit).

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { withBasePath } from '@/lib/base-path';
import { identityColor } from '@/lib/identity-color';
import { cardPalette } from '@/lib/profile/shared';
import type { ProfileCardView } from '@/lib/profile/types';
import {
  CARD_WIDTH,
  STAT_LABEL_KEY,
  compactCount,
  initialOf,
  isoYear,
  tintHex,
  type ProfileCardSize,
} from '@/components/profile-card/card-shared';
import { CARD_GRAIN_URL } from '@/components/profile-card/patterns';

/** Custom properties every style starts from. Colours are numbers-only output of cardPalette(). */
export function useCardBaseStyle(view: ProfileCardView, size: ProfileCardSize): CSSProperties {
  return useMemo(() => {
    const p = cardPalette(view.theme);
    return {
      '--pc-w': `${CARD_WIDTH[size]}px`,
      '--pc-base': p.base,
      '--pc-empty': p.emptyGradient,
      '--pc-overlay': p.overlay,
      '--inner-gradient': p.innerGradient,
      '--behind-glow-color': p.glow,
      '--pc-name-end': tintHex(p.base, 0.42),
      '--pc-title-end': tintHex(p.base, 0.28),
      '--grain': CARD_GRAIN_URL,
    } as CSSProperties;
  }, [view.theme, size]);
}

/**
 * `data-inview` on the element while it intersects the viewport, toggled straight
 * on the DOM (no re-render, and React never owns the attribute so a re-render
 * cannot wipe it). The holo shine's idle drift keys on it: it animates
 * background-position, which cannot composite, so a running loop is a style
 * recalc + repaint every frame — on a hero scrolled away, or in a background
 * editor preview, forever.
 */
export function useInViewFlag(ref: RefObject<HTMLElement>, enabled: boolean): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    if (typeof IntersectionObserver === 'undefined') {
      el.setAttribute('data-inview', '');
      return () => el.removeAttribute('data-inview');
    }
    const io = new IntersectionObserver(([entry]) => el.toggleAttribute('data-inview', entry.isIntersecting));
    io.observe(el);
    return () => {
      io.disconnect();
      el.removeAttribute('data-inview');
    };
  }, [ref, enabled]);
}

export function useJoinedLine(view: ProfileCardView): string {
  const t = useTranslations('profile');
  const year = isoYear(view.joinedAt);
  return year ? t('card_joined_year', { year: String(year) }) : '';
}

/** The member's avatar as a disc; falls back to the identity-colour initial (same as <Avatar/>). */
export function MiniAvatar({ view, className }: { view: ProfileCardView; className: string }) {
  const [broken, setBroken] = useState(false);
  const label = view.displayName.trim() || view.handle;
  if (view.avatarUrl && !broken) {
    return (
      <span className={className}>
        {/* eslint-disable-next-line @next/next/no-img-element -- member upload / same-origin */}
        <img src={withBasePath(view.avatarUrl)} alt="" draggable={false} onError={() => setBroken(true)} />
      </span>
    );
  }
  return (
    <span className={className} style={{ backgroundColor: identityColor(label) }} aria-hidden>
      {initialOf(label)}
    </span>
  );
}

export function StatFigures({
  view,
  className,
  itemClassName,
  stacked = false,
  limit = 3,
}: {
  view: ProfileCardView;
  className: string;
  itemClassName?: string;
  /** reflective footer: figure above its label. */
  stacked?: boolean;
  limit?: number;
}) {
  const t = useTranslations('profile');
  const stats = view.stats.slice(0, limit);
  if (stats.length === 0) return null;
  return (
    <div className={className}>
      {stats.map((s) => (
        <span key={s.key} className={itemClassName}>
          <b>{compactCount(s.value)}</b>
          {stacked ? <span>{t(STAT_LABEL_KEY[s.key])}</span> : t(STAT_LABEL_KEY[s.key])}
        </span>
      ))}
    </div>
  );
}
