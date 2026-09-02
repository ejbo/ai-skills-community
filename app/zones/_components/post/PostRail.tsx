'use client';

// The reading page's right rail (xl only). Two shapes, chosen by the page band
// the preview host measures (`usePageBand`, never a viewport breakpoint —
// the viewport is 1440 whether or not 520 px of it is the docked panel):
//   wide   → the full rail: TOC (+ reading-progress hairline) → 作者 → 附件
//            → 数据, sticky under the navbar budget.
//   narrow → a 40 px STRIP of glyphs with the progress hairline running its
//            full height; hover / focus-within / tap opens the full rail as
//            an absolutely positioned OVERLAY (M12). An overlay on purpose —
//            never a width tween: the article the reader is in the middle of
//            must not reflow on hover. Pointer leave / blur / ESC close it
//            (ESC stops propagation so the dock's two-stage ESC never fires
//            for it); on touch the glyphs toggle. The open/close rules are
//            the pure `rail-strip.ts` (a tap focuses the glyph BEFORE it
//            clicks it, so a focus that follows a pointer press must not
//            open — or the click's toggle would close it again at once).
//            The strip container carries NO `title`: a native title applies
//            to every descendant without one, so it would have tooltipped
//            "展开侧栏" over the open overlay's TOC rows and author links.
// Rails use CONSTANT offsets (`top-24`): the navbar is held visible while a
// file is docked, so nothing here ever moves on scroll reversal.

import { useId, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { BarChart2, Bookmark, Clock, Eye, Heart, List, Paperclip, Users } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import type { PageBand } from '@/components/zones/preview/PreviewProvider';
import { relativeTime } from '@/lib/i18n-date';
import { TWEEN_FAST } from '@/lib/motion';
import { leadRoleOf, type LeadRoles } from '@/lib/zones/lead-roles';
import type { PublicAuthor } from '@/lib/user-identity';
import type { ZonePostDetailView } from '@/lib/zones/types';
import { RolePill } from '../RolePill';
import { BTN_ICON } from '../ui';
import { PostAttachmentsPanel } from './PostAttachmentsPanel';
import { PostToc } from './PostToc';
import { focusOpensStrip, stripGlyphAction } from './rail-strip';
import { ReadProgress } from './ReadProgress';

type RailSection = 'toc' | 'authors' | 'attachments' | 'stats';

const OVERLAY_WIDTH_PX = 260;

export function PostRail({
  band,
  post,
  authors,
  leadRoles,
  articleRef,
  className = '',
}: {
  band: PageBand;
  post: ZonePostDetailView;
  authors: PublicAuthor[];
  leadRoles?: LeadRoles;
  /** The article element — drives the reading-progress hairline. */
  articleRef: RefObject<HTMLElement>;
  className?: string;
}) {
  const t = useTranslations('zones');
  const reduce = useReducedMotion();
  const overlayId = useId();
  const [open, setOpen] = useState(false);
  const pointerType = useRef<string>('mouse');
  const pointerDownAt = useRef<number>(Number.NEGATIVE_INFINITY);
  const sectionRefs = useRef<Partial<Record<RailSection, HTMLElement | null>>>({});

  const sections = (
    <>
      <div
        ref={(el) => {
          sectionRefs.current.toc = el;
        }}
      >
        <PostToc headings={post.headings} articleRef={articleRef} />
      </div>
      <AuthorsSection authors={authors} leadRoles={leadRoles} sectionRef={(el) => (sectionRefs.current.authors = el)} />
      <div
        ref={(el) => {
          sectionRefs.current.attachments = el;
        }}
      >
        <PostAttachmentsPanel attachments={post.attachments} />
      </div>
      <StatsSection post={post} sectionRef={(el) => (sectionRefs.current.stats = el)} />
    </>
  );

  if (band === 'wide') {
    return <div className={`sticky top-24 space-y-7 ${className}`}>{sections}</div>;
  }

  // ── narrow: strip + overlay ──────────────────────────────────────────────
  const glyphs: { key: RailSection; label: string; icon: ReactNode; count?: number; show: boolean }[] = [
    { key: 'toc', label: t('rail_strip_toc'), icon: <List className="h-4 w-4" />, show: post.headings.length > 0 },
    { key: 'authors', label: t('rail_strip_authors'), icon: <Users className="h-4 w-4" />, show: true },
    {
      key: 'attachments',
      label: t('rail_strip_attachments'),
      icon: <Paperclip className="h-4 w-4" />,
      count: post.attachments.length,
      show: post.attachments.length > 0,
    },
    { key: 'stats', label: t('rail_strip_stats'), icon: <BarChart2 className="h-4 w-4" />, show: true },
  ];

  const reveal = (section: RailSection) => {
    setOpen(true);
    // Scroll the overlay to the section the glyph names once it is mounted.
    requestAnimationFrame(() => sectionRefs.current[section]?.scrollIntoView({ block: 'nearest' }));
  };

  const onPointerEnter = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') setOpen(true);
  };
  const onPointerLeave = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') setOpen(false);
  };
  // Capture phase so a press anywhere in the strip (glyphs AND overlay content)
  // is on record before the focus it causes.
  const onPointerDownCapture = (e: PointerEvent<HTMLDivElement>) => {
    pointerType.current = e.pointerType;
    pointerDownAt.current = performance.now();
  };
  const onFocus = () => {
    if (focusOpensStrip(pointerDownAt.current, performance.now())) setOpen(true);
  };
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || !open) return;
    e.stopPropagation();
    setOpen(false);
  };

  return (
    <div
      role="group"
      aria-label={t('rail_strip_group')}
      className={`sticky top-24 w-10 ${className}`}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerDownCapture={onPointerDownCapture}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    >
      <div className="relative flex w-10 flex-col items-center gap-1 border-l border-zinc-200 py-1 dark:border-zinc-800">
        <ReadProgress target={articleRef} />
        {glyphs
          .filter((g) => g.show)
          .map((g) => (
            <button
              key={g.key}
              type="button"
              aria-label={g.label}
              title={g.label}
              aria-expanded={open}
              aria-controls={overlayId}
              className={`${BTN_ICON} relative`}
              onClick={() => {
                // Hover already opened it for a mouse — a click there must not close it;
                // touch has no hover, so a tap toggles.
                if (stripGlyphAction(pointerType.current, open) === 'close') setOpen(false);
                else reveal(g.key);
              }}
            >
              {g.icon}
              {g.count != null && g.count > 0 && (
                <span
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 min-w-[14px] rounded-full bg-zinc-900 px-1 text-center font-mono text-[9px] leading-[14px] text-white dark:bg-zinc-50 dark:text-zinc-900"
                >
                  {g.count > 99 ? '99+' : g.count}
                </span>
              )}
            </button>
          ))}
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            id={overlayId}
            className="surface absolute right-0 top-0 z-20 max-h-[calc(100dvh-7rem)] space-y-7 overflow-y-auto rounded-xl p-4 shadow-lg scroll-thin"
            style={{ width: OVERLAY_WIDTH_PX }}
            initial={{ opacity: 0, x: reduce ? 0 : 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: reduce ? 0 : 8 }}
            transition={reduce ? { duration: 0 } : TWEEN_FAST}
          >
            {sections}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AuthorsSection({
  authors,
  leadRoles,
  sectionRef,
}: {
  authors: PublicAuthor[];
  leadRoles?: LeadRoles;
  sectionRef: (el: HTMLElement | null) => void;
}) {
  const t = useTranslations('zones');
  return (
    <section ref={sectionRef} aria-label={t('post_authors')}>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{t('post_authors')}</h3>
      <ul className="space-y-2">
        {authors.map((a) => {
          const role = leadRoleOf(leadRoles, a.handle);
          return (
            <li key={a.handle}>
              <Link href={`/users/${a.handle}`} className="flex items-center gap-2.5 rounded-lg p-1 transition hover:bg-zinc-100 dark:hover:bg-zinc-900">
                <Avatar name={a.displayName} src={a.avatarUrl} size="md" handle={a.handle} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 truncate text-sm font-medium">{a.displayName}</span>
                    {role && <RolePill role={role} />}
                  </span>
                  <DeptTag department={a.department} lab={a.lab} className="relative z-[1]" />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function StatsSection({ post, sectionRef }: { post: ZonePostDetailView; sectionRef: (el: HTMLElement | null) => void }) {
  const t = useTranslations('zones');
  const locale = useLocale();
  const cell = 'rounded-lg border border-zinc-200 px-2.5 py-2 dark:border-zinc-800';
  const label = 'inline-flex items-center gap-1 text-muted';
  const figure = 'mt-0.5 font-mono text-base tabular-nums';
  return (
    <section ref={sectionRef} aria-label={t('post_stats')}>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{t('post_stats')}</h3>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div className={cell}>
          <dt className={label}>
            <Eye className="h-3 w-3" />
            {t('post_stat_views')}
          </dt>
          <dd className={figure}>{post.viewCount}</dd>
        </div>
        <div className={cell}>
          <dt className={label}>
            <Heart className="h-3 w-3" />
            {t('post_stat_likes')}
          </dt>
          <dd className={figure}>{post.likeCount}</dd>
        </div>
        <div className={cell}>
          <dt className={label}>
            <Bookmark className="h-3 w-3" />
            {t('post_stat_bookmarks')}
          </dt>
          <dd className={figure}>{post.bookmarkCount}</dd>
        </div>
        <div className={cell}>
          <dt className={label}>
            <Clock className="h-3 w-3" />
            {t('post_stat_read')}
          </dt>
          <dd className={figure}>{t('post_read_minutes', { count: post.readMinutes })}</dd>
        </div>
      </dl>
      <p className="mt-2 text-[11px] text-muted" suppressHydrationWarning>
        {post.publishedAt ? t('post_published_at', { time: relativeTime(post.publishedAt, locale) }) : t('post_created_at', { time: relativeTime(post.createdAt, locale) })}
        {post.editedAt && ` · ${t('post_edited_at', { time: relativeTime(post.editedAt, locale) })}`}
      </p>
    </section>
  );
}
