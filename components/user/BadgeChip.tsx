'use client';

// 徽章 — a member's title as a chip, with the title's MEANING one hover away.
//
// The chip is only a name; what an admin meant by 「布道师」 lives in the
// detail popover (icon disc in the badge colour, name, who granted it, the
// description, when it was received). Interaction contract, copied from the
// DeptTag tooltip and the hover card and extended for an INTERACTIVE bubble:
//   - mouse: 120 ms hover intent opens; leaving the chip closes after a short
//     grace that the popover cancels (the hover bridge), so the pointer can
//     travel onto the bubble without it vanishing;
//   - touch: a tap toggles (the synthetic pointerleave after a tap is ignored);
//   - keyboard: focus-visible opens, Enter/Space toggles, Esc closes;
//   - an outside pointerdown, a scroll or a resize closes.
// Esc closes ONLY this popover: its listener runs in the window CAPTURE phase and
// stops the event there, because the popover usually sits inside another layer
// that also closes on Esc (the hover card, a drawer, the vote lightbox) and a
// chip-level stopPropagation cannot reach their document/window listeners.
// The chip is a focusable <span>, not a <button>: chips render inside linked
// rows elsewhere, and a button inside an <a> is invalid — its click is
// swallowed (preventDefault) so it never navigates the row instead.
// The popover is PORTALED (fullscreen element ?? body) at z-[115]: badge rows
// sit inside tilted cards (a transform re-parents `fixed`), overflow-hidden
// cards and the z-[105] hover card, which it must clear.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { useLocale, useTranslations } from 'next-intl';
import { badgeIconFor } from '@/components/user/badge-icons';
import { EASE_OUT } from '@/lib/motion';
import type { ProfileBadge } from '@/lib/profile/types';
import { tagColorClass } from '@/lib/user-tags';

const OPEN_DELAY_MS = 120;
const CLOSE_DELAY_MS = 140;
const GAP_PX = 8;
const EDGE_PX = 12;

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

// ─── popover mechanics (shared by a badge chip and the "+N" chip) ────────

interface Placement {
  left: number;
  top: number;
  originX: number;
  below: boolean;
}

function useDetailPopover() {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Placement | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const [host, setHost] = useState<Element | null>(null);

  const clearTimers = useCallback(() => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  const show = useCallback(() => {
    clearTimers();
    setHost(document.fullscreenElement ?? document.body);
    setOpen(true);
  }, [clearTimers]);

  const hide = useCallback(() => {
    clearTimers();
    setOpen(false);
    setPlace(null);
  }, [clearTimers]);

  const scheduleShow = useCallback(() => {
    clearTimers();
    openTimer.current = window.setTimeout(show, OPEN_DELAY_MS);
  }, [clearTimers, show]);

  const scheduleHide = useCallback(() => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    openTimer.current = null;
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(hide, CLOSE_DELAY_MS);
  }, [hide]);

  useEffect(() => clearTimers, [clearTimers]);

  // Measure, then place: above the chip by default, below when the top has no
  // room, clamped horizontally; the entrance scales out of the chip's centre.
  useIsomorphicLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const r = anchor.getBoundingClientRect();
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const roomAbove = r.top - GAP_PX - EDGE_PX;
    const roomBelow = vh - r.bottom - GAP_PX - EDGE_PX;
    const below = roomAbove < h && roomBelow > roomAbove;
    let top = below ? r.bottom + GAP_PX : r.top - GAP_PX - h;
    top = Math.max(EDGE_PX, Math.min(top, vh - EDGE_PX - h));
    const cx = r.left + r.width / 2;
    const left = Math.max(EDGE_PX, Math.min(cx - w / 2, vw - EDGE_PX - w));
    setPlace({ left, top, below, originX: Math.max(0, Math.min(w, cx - left)) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) =>
      t instanceof Node && (!!anchorRef.current?.contains(t) || !!panelRef.current?.contains(t));
    const onPointerDown = (e: PointerEvent) => {
      if (!inside(e.target)) hide();
    };
    const onScroll = (e: Event) => {
      if (!inside(e.target)) hide();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Innermost layer only — the next Esc reaches the card/drawer around it.
      e.stopImmediatePropagation();
      hide();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', hide);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', hide);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, hide]);

  const anchorProps = {
    ref: anchorRef,
    onPointerEnter: (e: ReactPointerEvent) => {
      if (e.pointerType !== 'touch') scheduleShow();
    },
    onPointerLeave: (e: ReactPointerEvent) => {
      // The browser fires pointerleave right after a tap's pointerup; a touch
      // popover closes on an outside tap or scroll instead.
      if (e.pointerType !== 'touch') scheduleHide();
    },
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.pointerType !== 'touch') return;
      if (open) hide();
      else show();
    },
    onClick: (e: React.MouseEvent) => {
      // Never let a chip inside a linked row navigate the row.
      e.preventDefault();
      e.stopPropagation();
    },
    onFocus: (e: React.FocusEvent<HTMLSpanElement>) => {
      if (e.currentTarget.matches(':focus-visible')) show();
    },
    onBlur: () => scheduleHide(),
    onKeyDown: (e: ReactKeyboardEvent) => {
      // (Esc while open never gets here: the capture listener above took it.)
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (open) hide();
        else show();
      }
    },
  };

  const panelProps = {
    ref: panelRef,
    onPointerEnter: (e: ReactPointerEvent) => {
      if (e.pointerType !== 'touch') clearTimers();
    },
    onPointerLeave: (e: ReactPointerEvent) => {
      if (e.pointerType !== 'touch') scheduleHide();
    },
  };

  return { open, place, host, anchorProps, panelProps };
}

function PopoverShell({
  id,
  place,
  host,
  panelProps,
  children,
  width,
}: {
  id: string;
  place: Placement | null;
  host: Element | null;
  panelProps: ReturnType<typeof useDetailPopover>['panelProps'];
  children: ReactNode;
  width: string;
}) {
  const reduce = useReducedMotion();
  if (!host) return null;
  return createPortal(
    <motion.div
      {...panelProps}
      id={id}
      role="tooltip"
      initial={reduce ? false : { opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.14, ease: EASE_OUT }}
      style={{
        left: place?.left ?? 0,
        top: place?.top ?? 0,
        // First layout pass measures invisibly at 0,0; the layout effect places
        // it before paint.
        visibility: place ? 'visible' : 'hidden',
        transformOrigin: place ? `${place.originX}px ${place.below ? '0%' : '100%'}` : undefined,
      }}
      className={`surface fixed z-[115] ${width} max-w-[calc(100vw-24px)] rounded-2xl p-3.5 text-left shadow-xl ring-1 ring-black/5 dark:ring-white/10`}
    >
      {children}
    </motion.div>,
    host,
  );
}

// ─── chip styling ────────────────────────────────────────────────────────

type ChipSize = 'sm' | 'md';
type ChipTone = 'surface' | 'glass';

const SIZE_CLS: Record<ChipSize, { chip: string; icon: string }> = {
  sm: { chip: 'h-5 gap-1 px-1.5 text-[11px]', icon: 'h-3 w-3' },
  md: { chip: 'h-6 gap-1.5 px-2 text-xs', icon: 'h-3.5 w-3.5' },
};

function chipToneClass(tone: ChipTone, color: string): string {
  return tone === 'glass'
    ? 'bg-white/10 text-white/90 ring-1 ring-inset ring-white/15 backdrop-blur-md hover:bg-white/[0.16] focus-visible:ring-2 focus-visible:ring-white/70'
    : `${tagColorClass(color)} ring-1 ring-inset ring-black/[0.04] dark:ring-white/[0.06] focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100`;
}

const CHIP_BASE =
  'inline-flex max-w-[11rem] shrink-0 cursor-default select-none items-center rounded-full font-medium leading-none outline-none transition-colors';

function KindLabel({ kind }: { kind: ProfileBadge['kind'] }) {
  const t = useTranslations('profile');
  return (
    <span className="inline-flex items-center rounded-full border border-zinc-200 px-1.5 py-0.5 text-[10px] leading-none text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
      {t(`badge_kind_${kind}`)}
    </span>
  );
}

function formatGranted(iso: string, locale: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ─── BadgeChip ───────────────────────────────────────────────────────────

export interface BadgeChipProps {
  badge: ProfileBadge;
  /** sm = inline chip (cards, rows) · md = profile header. */
  size?: 'sm' | 'md';
  /** surface = on the page ground · glass = on a dark card. */
  tone?: 'surface' | 'glass';
  className?: string;
}

/** A badge chip; hover / focus / tap opens a portaled detail popover. */
export function BadgeChip({ badge, size = 'sm', tone = 'surface', className = '' }: BadgeChipProps) {
  const t = useTranslations('profile');
  const locale = useLocale();
  const id = useId();
  const { open, place, host, anchorProps, panelProps } = useDetailPopover();
  const Icon = badgeIconFor(badge);
  const s = SIZE_CLS[size];
  const granted = badge.grantedAt ? formatGranted(badge.grantedAt, locale) : null;

  return (
    <>
      <span
        {...anchorProps}
        tabIndex={0}
        aria-describedby={open ? id : undefined}
        className={`${CHIP_BASE} ${s.chip} ${chipToneClass(tone, badge.color)} ${className}`}
      >
        <Icon className={`${s.icon} shrink-0`} aria-hidden />
        <span className="truncate">{badge.name}</span>
      </span>
      {open && (
        <PopoverShell id={id} place={place} host={host} panelProps={panelProps} width="w-64">
          <div className="flex items-start gap-3">
            <span
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ring-4 ring-black/[0.03] dark:ring-white/[0.04] ${tagColorClass(badge.color)}`}
            >
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="break-words text-sm font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
                {badge.name}
              </p>
              <div className="mt-1">
                <KindLabel kind={badge.kind} />
              </div>
            </div>
          </div>
          <p
            className={`mt-3 whitespace-pre-line break-words text-[13px] leading-relaxed ${
              badge.description ? 'text-zinc-700 dark:text-zinc-300' : 'italic text-zinc-400 dark:text-zinc-500'
            }`}
          >
            {badge.description || t('badge_no_description')}
          </p>
          {granted && (
            <p className="mt-3 border-t border-zinc-100 pt-2.5 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              {t('badge_granted_at', { date: granted })}
            </p>
          )}
        </PopoverShell>
      )}
    </>
  );
}

// ─── BadgeList ───────────────────────────────────────────────────────────

export interface BadgeListProps {
  badges: ProfileBadge[];
  /** Chips shown before a "+N" overflow chip (whose popover lists the rest). Default: all. */
  max?: number;
  size?: 'sm' | 'md';
  tone?: 'surface' | 'glass';
  className?: string;
}

export function BadgeList({ badges, max, size = 'sm', tone = 'surface', className = '' }: BadgeListProps) {
  if (badges.length === 0) return null;
  const limit = max === undefined ? badges.length : Math.max(0, Math.floor(max));
  const shown = badges.slice(0, limit);
  const rest = badges.slice(limit);
  return (
    <span className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {shown.map((b) => (
        <BadgeChip key={b.key} badge={b} size={size} tone={tone} />
      ))}
      {rest.length > 0 && <MoreChip rest={rest} size={size} tone={tone} />}
    </span>
  );
}

function MoreChip({ rest, size, tone }: { rest: ProfileBadge[]; size: ChipSize; tone: ChipTone }) {
  const t = useTranslations('profile');
  const id = useId();
  const { open, place, host, anchorProps, panelProps } = useDetailPopover();
  const s = SIZE_CLS[size];
  return (
    <>
      <span
        {...anchorProps}
        tabIndex={0}
        aria-label={t('badge_more_aria', { count: rest.length })}
        aria-describedby={open ? id : undefined}
        className={`${CHIP_BASE} ${s.chip} ${chipToneClass(tone, 'zinc')} font-mono tabular-nums`}
      >
        +{rest.length}
      </span>
      {open && (
        <PopoverShell id={id} place={place} host={host} panelProps={panelProps} width="w-72">
          <p className="mb-2 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{t('badge_more_title')}</p>
          <ul className="scroll-thin -mx-1 max-h-[min(60vh,22rem)] space-y-0.5 overflow-y-auto">
            {rest.map((b) => {
              const Icon = badgeIconFor(b);
              return (
                <li key={b.key} className="flex items-start gap-2.5 rounded-lg px-1 py-1.5">
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${tagColorClass(b.color)}`}>
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
                      <span className="break-words">{b.name}</span>
                      <KindLabel kind={b.kind} />
                    </p>
                    <p
                      className={`mt-0.5 line-clamp-2 break-words text-xs leading-relaxed ${
                        b.description ? 'text-zinc-600 dark:text-zinc-400' : 'italic text-zinc-400 dark:text-zinc-500'
                      }`}
                    >
                      {b.description || t('badge_no_description')}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </PopoverShell>
      )}
    </>
  );
}
