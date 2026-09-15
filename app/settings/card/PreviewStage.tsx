'use client';

// The live stage beside the 名片 editor: the draft rendered as the real
// <ProfileCard/> on a dotted ground lit faintly in the card's own theme colour.
//
// Two views, one at a time (a md card plus a sm card stacked is ~950 px — taller
// than the sticky column can ever show):
//   名片   — size md from `view` (the member's own profile hero), interactive
//            (tilt), video playing, drag the media to reframe
//   悬停时 — size sm from `hoverView` under a mock byline: what an ordinary
//            signed-in member sees when they rest the pointer on your AVATAR
//            (the card opens on avatars; bylines' name links do not carry it)
// Only the visible card plays video, which is also what the card's module-level
// "one active video" guard would enforce anyway.
//
// Touch: a finger on the preview must scroll the page, so on a coarse primary
// pointer reframing is an explicit 调整取景 mode (a toggle in the footer) that
// passes `touchReframe` to the card only while it is on. Mouse / pen reframe
// directly, as before. The mode switches itself off whenever reframing stops
// applying (no media, 悬停时 tab).
//
// Footer hints WRAP (never truncate): the en/fr sentences are twice the width of
// the zh ones and the stage column is only 340–372 px, so a one-line ellipsis
// cut them mid-word.

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { MousePointer2, Move, RotateCcw } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { ProfileCard } from '@/components/profile-card/ProfileCard';
import { cardPalette } from '@/lib/profile/shared';
import type { ProfileCardView } from '@/lib/profile/types';
import { BTN_GHOST, SEGMENT_GROUP_CLS, segmentCls } from '../_components/ui';
import { useCoarsePointer } from '../_components/useCoarsePointer';
import { ScaledPreview } from './ScaledPreview';

export type StageMode = 'card' | 'hover';

const MD_ESTIMATE = { width: 320, height: 446 };

export function PreviewStage({
  view,
  hoverView,
  mode,
  onModeChange,
  onMediaPosChange,
  onResetPos,
}: {
  /** Draft over the owner's own card view (名片 mode). */
  view: ProfileCardView;
  /** Draft over the ordinary-member view (悬停时 mode). */
  hoverView: ProfileCardView;
  mode: StageMode;
  onModeChange: (m: StageMode) => void;
  onMediaPosChange: (pos: string) => void;
  onResetPos: () => void;
}) {
  const t = useTranslations('settings');
  const coarse = useCoarsePointer();
  const [touchReframe, setTouchReframe] = useState(false);
  const base = cardPalette(view.theme).base;
  const hasMedia = !!view.media;
  const canReframe = hasMedia && mode === 'card';
  const reframeToggle = coarse && canReframe;

  useEffect(() => {
    if (!reframeToggle) setTouchReframe(false);
  }, [reframeToggle]);

  return (
    <div className="overflow-hidden rounded-3xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inset-0 rounded-full bg-zinc-900 motion-safe:animate-ping motion-safe:opacity-40 dark:bg-zinc-100" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-zinc-900 dark:bg-zinc-100" />
          </span>
          {t('ce_preview_live')}
        </span>
        <div role="tablist" aria-label={t('ce_preview_live')} className={SEGMENT_GROUP_CLS}>
          <button type="button" role="tab" aria-selected={mode === 'card'} onClick={() => onModeChange('card')} className={segmentCls(mode === 'card')}>
            {t('ce_preview_card')}
          </button>
          <button type="button" role="tab" aria-selected={mode === 'hover'} onClick={() => onModeChange('hover')} className={segmentCls(mode === 'hover')}>
            {t('ce_preview_hover')}
          </button>
        </div>
      </div>

      <div
        className="relative px-3 py-8 sm:px-6"
        style={{
          backgroundImage: `radial-gradient(60% 50% at 50% 42%, ${base}2e 0%, transparent 70%), radial-gradient(rgb(var(--text) / 0.09) 1px, transparent 1px)`,
          backgroundSize: '100% 100%, 14px 14px',
        }}
      >
        {mode === 'card' ? (
          <ScaledPreview fit="down" estimate={MD_ESTIMATE}>
            <ProfileCard
              view={view}
              size="md"
              onMediaPosChange={hasMedia ? onMediaPosChange : undefined}
              touchReframe={reframeToggle && touchReframe}
            />
          </ScaledPreview>
        ) : (
          <div className="flex flex-col items-center">
            <div className="relative flex max-w-full items-center gap-2 rounded-full border border-zinc-200 bg-white py-1 pl-1 pr-3 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-950">
              <Avatar name={hoverView.displayName} src={hoverView.avatarUrl} size="sm" />
              <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">{hoverView.displayName}</span>
              <span className="shrink-0 text-muted">{t('ce_preview_hover_context')}</span>
              {/* The pointer rests on the AVATAR — that is what opens the card. */}
              <MousePointer2
                aria-hidden
                className="absolute left-4 top-[calc(100%-0.6rem)] h-4 w-4 fill-zinc-900 text-white drop-shadow dark:fill-zinc-100 dark:text-zinc-900"
              />
            </div>
            <div className="mt-3 w-full">
              <ScaledPreview fit="down" estimate={{ width: 288, height: 401 }}>
                <ProfileCard view={hoverView} size="sm" />
              </ScaledPreview>
            </div>
          </div>
        )}
      </div>

      <div className="flex min-h-[2.75rem] items-center justify-between gap-3 border-t border-zinc-200 px-4 py-2 text-xs leading-snug dark:border-zinc-800">
        <span className="flex min-w-0 items-center gap-2 text-muted">
          {reframeToggle ? (
            <>
              <button
                type="button"
                aria-pressed={touchReframe}
                onClick={() => setTouchReframe((v) => !v)}
                className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 dark:focus-visible:ring-zinc-100/30 ${
                  touchReframe
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'border border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300'
                }`}
              >
                <Move className="h-3.5 w-3.5" />
                {t('ce_preview_reframe')}
              </button>
              {touchReframe && <span className="min-w-0">{t('ce_preview_drag_hint')}</span>}
            </>
          ) : canReframe ? (
            <>
              <Move className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0">{t('ce_preview_drag_hint')}</span>
            </>
          ) : (
            <span className="min-w-0">{mode === 'hover' ? t('ce_preview_hover_hint') : t('ce_preview_card_hint')}</span>
          )}
        </span>
        {canReframe && view.card.mediaPos && (
          <button type="button" onClick={onResetPos} className={`${BTN_GHOST} h-7 shrink-0 px-2 text-xs`}>
            <RotateCcw className="h-3.5 w-3.5" />
            {t('ce_preview_reset_pos')}
          </button>
        )}
      </div>
    </div>
  );
}
