// Shared scaffolding for every 个人主页 section tab: the slim header (count,
// 仅自己可见 note, owner CTA), the owner's per-item tool cluster (置顶 + 管理),
// the empty states and the pagers. Server components; the only client leaf is
// PinButton.

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight, ChevronsLeft, EyeOff, PenLine, Plus } from 'lucide-react';
import type { PinKind, ProfileSection } from '@/lib/profile/shared';
import { PinButton } from '../PinButton';
import { profileHref } from '../profile-href';
import { SECTION_CREATE_HREF, SECTION_ICONS } from '../section-meta';

export function SectionHeader({
  section,
  total,
  hiddenFromPublic,
  isOwner,
  empty,
}: {
  section: ProfileSection;
  /** null when the section pages by cursor and has no cheap total to show. */
  total: number | null;
  hiddenFromPublic: boolean;
  isOwner: boolean;
  /** The tab renders `SectionEmpty`, which carries the create CTA itself — no second copy up here. */
  empty: boolean;
}) {
  const t = useTranslations('profile');
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2">
      <h2 className="text-base font-semibold tracking-tight">{t(`tab_${section}`)}</h2>
      {total != null && (
        <span className="font-mono text-xs tabular-nums text-muted">{t('sec_total', { count: total })}</span>
      )}
      {hiddenFromPublic && (
        <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          <EyeOff className="h-3 w-3" aria-hidden />
          {isOwner ? t('sec_hidden_note_owner') : t('hidden_badge')}
        </span>
      )}
      {isOwner && !empty && section !== 'comments' && section !== 'shelf' && (
        <Link
          href={SECTION_CREATE_HREF[section]}
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs font-medium text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:text-zinc-50"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t(`sec_cta_${section}`)}
        </Link>
      )}
    </div>
  );
}

/** Owner-only empty state (visitors never reach an empty tab). */
export function SectionEmpty({ section }: { section: ProfileSection }) {
  const t = useTranslations('profile');
  const Icon = SECTION_ICONS[section];
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 px-6 py-14 text-center dark:border-zinc-700">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <p className="mt-3 text-sm font-medium">{t(`sec_empty_${section}`)}</p>
      <p className="mt-1 max-w-sm text-xs text-muted">{t('sec_empty_hint')}</p>
      <Link
        href={SECTION_CREATE_HREF[section]}
        className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
      >
        {t(`sec_cta_${section}`)}
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </div>
  );
}

/**
 * Owner tools on a card: 管理/编辑 and 置顶. Siblings of the card's own link
 * (never nested interactive-in-interactive). A card gets them straddling its
 * bottom edge — the top-right corner is where every domain card puts its own
 * badges (source, visibility, attend) — a list row gets a side column. Hidden
 * until hover/focus on pointer devices, always shown on touch, and always shown
 * for a pinned item so the pin reads as a state.
 */
export function OwnerItem({
  enabled,
  pin,
  editHref,
  placement = 'edge',
  className = '',
  children,
}: {
  enabled: boolean;
  pin?: { kind: PinKind; id: string; pinned: boolean } | null;
  editHref?: string | null;
  /** edge = straddling a card's bottom edge · media = over a poster's top-right · side = a column beside a list row. */
  placement?: 'edge' | 'media' | 'side';
  className?: string;
  children: React.ReactNode;
}) {
  const t = useTranslations('profile');
  if (!enabled || (!pin && !editHref)) return <div className={className}>{children}</div>;
  const visibility = pin?.pinned
    ? 'opacity-100'
    : 'opacity-0 focus-within:opacity-100 group-hover/item:opacity-100 [@media(hover:none)]:opacity-100';
  const tools = (
    <>
      {editHref && (
        <Link
          href={editHref}
          aria-label={t('pin_manage')}
          title={t('pin_manage')}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-zinc-600 shadow-sm ring-1 ring-zinc-200 transition hover:text-zinc-900 hover:ring-zinc-400 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:text-zinc-50 dark:hover:ring-zinc-500"
        >
          <PenLine className="h-3.5 w-3.5" aria-hidden />
        </Link>
      )}
      {pin && <PinButton kind={pin.kind} id={pin.id} pinned={pin.pinned} />}
    </>
  );
  if (placement === 'side') {
    return (
      <div className={`group/item flex items-start gap-2 ${className}`}>
        <div className="min-w-0 flex-1">{children}</div>
        <div className={`flex shrink-0 items-center gap-1.5 pt-3 transition-opacity duration-150 ${visibility}`}>{tools}</div>
      </div>
    );
  }
  return (
    <div className={`group/item relative ${className}`}>
      {children}
      <div
        className={`absolute z-[2] flex items-center gap-1.5 transition-opacity duration-150 ${
          placement === 'media' ? 'right-2 top-2' : '-bottom-3 right-3'
        } ${visibility}`}
      >
        {tools}
      </div>
    </div>
  );
}

const PAGER_BTN =
  'inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 px-3.5 text-sm font-medium text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:text-zinc-50';

export function OffsetPager({
  handle,
  section,
  page,
  pageCount,
  visitor,
  cursor = null,
  className = 'mt-8',
}: {
  handle: string;
  section: ProfileSection;
  page: number;
  pageCount: number;
  visitor: boolean;
  /** A keyset cursor another pager on the same tab owns (视频: shorts) — kept on every link. */
  cursor?: string | null;
  className?: string;
}) {
  const t = useTranslations('profile');
  if (pageCount <= 1) return null;
  return (
    <nav aria-label={t('sec_pager_aria')} className={`flex items-center justify-center gap-3 ${className}`}>
      {page > 1 ? (
        <Link href={profileHref(handle, { tab: section, page: page - 1, cursor, visitor })} className={PAGER_BTN}>
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          {t('sec_prev')}
        </Link>
      ) : (
        <span className={`${PAGER_BTN} pointer-events-none opacity-40`} aria-hidden>
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('sec_prev')}
        </span>
      )}
      <span className="font-mono text-xs tabular-nums text-muted">
        {page} / {pageCount}
      </span>
      {page < pageCount ? (
        <Link href={profileHref(handle, { tab: section, page: page + 1, cursor, visitor })} className={PAGER_BTN}>
          {t('sec_next')}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      ) : (
        <span className={`${PAGER_BTN} pointer-events-none opacity-40`} aria-hidden>
          {t('sec_next')}
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      )}
    </nav>
  );
}

/** Keyset lists only move forward; "最新" jumps back to the first page. */
export function CursorPager({
  handle,
  section,
  cursor,
  nextCursor,
  visitor,
  page,
}: {
  handle: string;
  section: ProfileSection;
  cursor: string | null;
  nextCursor: string | null;
  visitor: boolean;
  /** An offset page another pager on the same tab owns (视频: long videos) — kept on every link. */
  page?: number;
}) {
  const t = useTranslations('profile');
  if (!cursor && !nextCursor) return null;
  return (
    <nav aria-label={t('sec_pager_aria')} className="mt-8 flex items-center justify-center gap-3">
      {cursor && (
        <Link href={profileHref(handle, { tab: section, page, visitor })} className={PAGER_BTN}>
          <ChevronsLeft className="h-3.5 w-3.5" aria-hidden />
          {t('sec_newest')}
        </Link>
      )}
      {nextCursor && (
        <Link href={profileHref(handle, { tab: section, page, cursor: nextCursor, visitor })} className={PAGER_BTN}>
          {t('sec_older')}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      )}
    </nav>
  );
}
