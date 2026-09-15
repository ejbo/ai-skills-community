'use client';

// 名片 — THE card a member designs for themselves. One component, three
// styles (CardConfig.style), rendered identically by the hover card
// (UserHoverCard, sm), the profile hero (lg/md) and the settings editor
// preview (md + sm) — all from a ProfileCardView built server-side, so
// identity trimming, badge filtering and stat gating are already done.
//
//   holo       全息卡  React Bits <ProfileCard/>    (HoloCard.tsx)
//   reflective 镜面卡  React Bits <ReflectiveCard/> (ReflectiveCard.tsx)
//   minimal    简约卡  site-theme surface card      (MinimalCard.tsx)
//
// Motion gate: tilt + pointer light only when `interactive`, the member left
// `card.tilt` on, the pointer is fine and motion is not reduced. `useFinePointer`
// is false on the server and `useReducedMotion` null, so SSR and the first
// client render agree on the static pose and the engine attaches after mount.
// A still card is a finished design, not a broken animation: the holo shine
// drifts on its CSS loop while an interactive card is on screen (never on a
// non-interactive mini, off under reduced motion) and the glow rests faintly.
//
// Styles live in ./profile-card.css, scoped under `.pc-root` (imported here, so
// any surface that renders a card gets them). The hover card imports this module
// LAZILY for exactly that reason — keep the skeleton in ./CardSkeleton, CSS-free.

import './profile-card.css';
import { useReducedMotion } from 'framer-motion';
import { useFinePointer } from '@/lib/motion';
import type { ProfileCardView } from '@/lib/profile/types';
import type { ProfileCardSize } from '@/components/profile-card/card-shared';
import { HoloCard } from '@/components/profile-card/HoloCard';
import { MinimalCard } from '@/components/profile-card/MinimalCard';
import { ReflectiveCard } from '@/components/profile-card/ReflectiveCard';

// Only the TYPE is re-exported: a value exported from a 'use client' module is a
// client reference inside an RSC. Server code that needs card geometry imports
// ./card-shared (CARD_WIDTH, CARD_ASPECT, cardHeight) directly.
export type { ProfileCardSize } from '@/components/profile-card/card-shared';
export { ProfileCardSkeleton } from '@/components/profile-card/CardSkeleton';

export interface ProfileCardProps {
  view: ProfileCardView;
  /** sm = hover card (288px wide) · md = 320px (editor preview, mobile hero) · lg = 360px (profile hero). */
  size?: ProfileCardSize;
  /** CTA + name link target. Default `/users/<handle>`; null hides the CTA. */
  href?: string | null;
  /** Pointer tilt. Still gated by fine pointer, reduced motion and `view.card.tilt`. Default true. */
  interactive?: boolean;
  /** Autoplay the video loop (muted, inline). Default true. */
  playMedia?: boolean;
  /** Editor only: drag on the media to reframe; reports CSS object-position `'x% y%'`. */
  onMediaPosChange?: (pos: string) => void;
  /**
   * Editor only: let a TOUCH drag reframe the media too (an explicit 调整取景
   * mode). Off by default so a finger on the preview scrolls the page; mouse and
   * pen always reframe when `onMediaPosChange` is set.
   */
  touchReframe?: boolean;
  className?: string;
}

export function ProfileCard({
  view,
  size = 'md',
  href,
  interactive = true,
  playMedia = true,
  onMediaPosChange,
  touchReframe = false,
  className = '',
}: ProfileCardProps) {
  const fine = useFinePointer();
  const reduce = useReducedMotion();
  const target = href === undefined ? `/users/${encodeURIComponent(view.handle)}` : href;
  const live = interactive && view.card.tilt && fine && reduce === false;
  const props = { view, size, href: target, live, interactive, playMedia, onMediaPosChange, touchReframe, className };

  switch (view.card.style) {
    case 'reflective':
      return <ReflectiveCard {...props} />;
    case 'minimal':
      return <MinimalCard {...props} />;
    default:
      return <HoloCard {...props} />;
  }
}
