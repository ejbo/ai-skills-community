'use client';

// 名片样式 — three radio tiles, each a REAL <ProfileCard/> of that style built
// from the member's draft (their photo, colour, name), scaled into the tile.
// A description of "全息卡" is worth less than seeing your own face on it.
//
// The minis are inert: not interactive (no tilt), no video playback (the one
// playing card is the live stage), no CTA, pointer-events off and `inert` so a
// badge chip inside can neither open its popover nor take focus. Each tile is
// memoised on its view object, which the host derives from a deferred copy of
// the draft — the minis catch up after a keystroke instead of blocking it.

import { memo } from 'react';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { ProfileCard } from '@/components/profile-card/ProfileCard';
import { CARD_STYLES, type CardStyle } from '@/lib/profile/shared';
import type { ProfileCardView } from '@/lib/profile/types';
import { ScaledPreview } from './ScaledPreview';

/** Intrinsic `sm` card size per style (SPEC: 288 px wide; aspect 0.718 / 0.64) — only a first-paint estimate. */
export const CARD_SM_ESTIMATE: Record<CardStyle, { width: number; height: number }> = {
  holo: { width: 288, height: 401 },
  reflective: { width: 288, height: 450 },
  minimal: { width: 288, height: 401 },
};

function setInert(el: HTMLDivElement | null) {
  el?.setAttribute('inert', '');
}

const StyleTile = memo(function StyleTile({
  style,
  view,
  active,
  name,
  desc,
  onSelect,
}: {
  style: CardStyle;
  view: ProfileCardView;
  active: boolean;
  name: string;
  desc: string;
  onSelect: (s: CardStyle) => void;
}) {
  return (
    // A div, not a <button>: the mini card inside may render its own buttons
    // (badge chips), and interactive content nested in a button is invalid DOM.
    <div
      role="radio"
      aria-checked={active}
      aria-label={name}
      tabIndex={0}
      onClick={() => onSelect(style)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(style);
        }
      }}
      className={`group relative cursor-pointer flex min-w-0 flex-col overflow-hidden rounded-xl border text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 dark:focus-visible:ring-zinc-100 dark:focus-visible:ring-offset-zinc-950 ${
        active
          ? 'border-zinc-900 shadow-[0_0_0_1px_rgb(24_24_27)] dark:border-zinc-100 dark:shadow-[0_0_0_1px_rgb(244_244_245)]'
          : 'border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600'
      }`}
    >
      <div
        className="relative flex flex-1 items-center justify-center bg-zinc-100 px-2.5 py-3 sm:px-4 sm:py-4 dark:bg-zinc-900"
        style={{
          backgroundImage: 'radial-gradient(rgb(var(--text) / 0.07) 1px, transparent 1px)',
          backgroundSize: '10px 10px',
        }}
      >
        {/* `inert` via the DOM: React 18 has no boolean support for it (a JSX
            `inert` either fails typing or warns), and it is what keeps the mini
            card's own focusable chips out of the tab order. */}
        <div aria-hidden className="pointer-events-none w-full select-none" ref={setInert}>
          <ScaledPreview fit="width" clip estimate={CARD_SM_ESTIMATE[style]}>
            <ProfileCard view={view} size="sm" interactive={false} playMedia={false} href={null} />
          </ScaledPreview>
        </div>
        {active && (
          <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-white shadow dark:bg-zinc-100 dark:text-zinc-900">
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
        )}
      </div>
      <div className="border-t border-zinc-200 px-2.5 py-2 sm:px-3 dark:border-zinc-800">
        <span className="block truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">{name}</span>
        <span className="mt-0.5 hidden text-[11px] leading-snug text-muted sm:line-clamp-2">{desc}</span>
      </div>
    </div>
  );
});

export function StyleTiles({
  value,
  views,
  onChange,
}: {
  value: CardStyle;
  /** One prepared view per style (the host memoises them on a deferred draft). */
  views: Record<CardStyle, ProfileCardView>;
  onChange: (s: CardStyle) => void;
}) {
  const t = useTranslations('settings');
  return (
    <div role="radiogroup" aria-label={t('ce_style_title')} className="grid grid-cols-3 gap-2 sm:gap-3">
      {CARD_STYLES.map((s) => (
        <StyleTile
          key={s}
          style={s}
          view={views[s]}
          active={value === s}
          name={t(`ce_style_${s}`)}
          desc={t(`ce_style_${s}_desc`)}
          onSelect={onChange}
        />
      ))}
    </div>
  );
}
