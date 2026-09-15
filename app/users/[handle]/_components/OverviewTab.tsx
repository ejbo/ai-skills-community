// 概览 — the profile's front page: 精选 (the member's pins, re-gated for this
// viewer), 最近动态 (a merged timeline across every section this viewer may
// see) and, on lg, a right rail with 关于我 and 板块一览. Server component.

import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  BookOpen,
  CalendarDays,
  ChevronRight,
  Clapperboard,
  EyeOff,
  Layers,
  LibraryBig,
  MessageCircle,
  MessageSquarePlus,
  MessagesSquare,
  Newspaper,
  PenLine,
  Pin,
  Play,
  Sparkles,
  Vote,
  type LucideIcon,
} from 'lucide-react';
import { MAX_PINS, pinKey, sanitizePins, type ProfileSection } from '@/lib/profile/shared';
import {
  isHiddenButVisible,
  loadRecentActivity,
  type ActivityKind,
  type ProfileViewer,
  type SectionCounts,
} from '@/lib/profile/queries';
import { resolveProfilePins } from '@/lib/profile/pins';
import { relativeTime } from '@/lib/i18n-date';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { PinCard } from './PinCard';
import { StalePinsNotice } from './StalePinsNotice';
import { StaggerChildren } from './StaggerChildren';
import { profileHref } from './profile-href';
import { SECTION_ICONS } from './section-meta';

const ACTIVITY_ICONS: Record<ActivityKind, LucideIcon> = {
  skill: Sparkles,
  doc: BookOpen,
  post: Newspaper,
  topic: MessagesSquare,
  short: Clapperboard,
  video: Play,
  zonePost: Layers,
  event: CalendarDays,
  vote: Vote,
  feedback: MessageSquarePlus,
  post_comment: MessageCircle,
  topic_reply: MessageCircle,
  feedback_comment: MessageCircle,
  doc_comment: MessageCircle,
  shelf: LibraryBig,
};

export async function OverviewTab({
  viewer,
  handle,
  displayName,
  counts,
  aboutMd,
  rawPins,
}: {
  viewer: ProfileViewer;
  handle: string;
  displayName: string;
  counts: SectionCounts;
  aboutMd: string;
  rawPins: unknown;
}) {
  const [t, locale] = await Promise.all([getTranslations('profile'), getLocale()]);
  const [pins, activity] = await Promise.all([
    resolveProfilePins(viewer, rawPins, locale),
    loadRecentActivity(viewer, counts, 12),
  ]);
  const visitor = viewer.previewAsVisitor;
  // The owner's counter is what is STORED — the server's 精选已满 check counts
  // that list, not the cards that still resolve. The owner may see every
  // section and each resolver uses isOwnPinnable's gate, so a stored pin
  // missing from `pins` is a dead one (lib/profile/pins.ts, "Writes").
  const stored = viewer.isOwner ? sanitizePins(rawPins) : [];
  const resolvedKeys = new Set(pins.map(pinKey));
  const staleCount = stored.filter((p) => !resolvedKeys.has(pinKey(p))).length;
  const indexSections = viewer.allowed.filter((s) => viewer.isOwner || counts[s] > 0);
  const nothingPublic = pins.length === 0 && activity.length === 0 && !aboutMd && !viewer.isOwner;

  if (nothingPublic) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-zinc-700">
        <p className="text-sm text-muted">{t('ov_visitor_empty', { name: displayName })}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-10">
        {/* 精选 */}
        {(pins.length > 0 || viewer.isOwner) && (
          <section aria-labelledby="profile-pins">
            <SectionTitle id="profile-pins" icon={Pin}>
              {t('ov_pins_title')}
              {viewer.isOwner && stored.length > 0 && (
                <span className="ml-2 font-mono text-xs font-normal tabular-nums text-muted">
                  {stored.length}/{MAX_PINS}
                </span>
              )}
            </SectionTitle>
            {staleCount > 0 && <StalePinsNotice count={staleCount} />}
            {pins.length > 0 ? (
              <StaggerChildren className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" itemClassName="min-w-0">
                {pins.map((p) => (
                  <PinCard key={`${p.kind}:${p.id}`} pin={p} />
                ))}
              </StaggerChildren>
            ) : (
              <div className="flex items-start gap-4 rounded-2xl border border-dashed border-zinc-300 p-5 dark:border-zinc-700">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  <Pin className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t('ov_pins_owner_empty_title')}</p>
                  <p className="mt-1 text-sm text-muted">{t('ov_pins_owner_empty_desc', { max: MAX_PINS })}</p>
                </div>
              </div>
            )}
          </section>
        )}

        {/* 最近动态 */}
        <section aria-labelledby="profile-activity">
          <SectionTitle id="profile-activity" icon={null}>
            {t('ov_activity_title')}
          </SectionTitle>
          {activity.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-zinc-300 px-5 py-8 text-center text-sm text-muted dark:border-zinc-700">
              {viewer.isOwner ? t('ov_activity_empty_own') : t('ov_activity_empty')}
            </p>
          ) : (
            <ol className="relative">
              {/* The hairline spine runs behind the icon discs. */}
              <span aria-hidden className="absolute bottom-3 left-[15px] top-3 w-px bg-zinc-200 dark:bg-zinc-800" />
              {activity.map((item) => {
                const Icon = ACTIVITY_ICONS[item.kind];
                const isComment = item.kind.endsWith('_comment') || item.kind === 'topic_reply';
                const hasParent = isComment && item.context !== null;
                return (
                  <li key={item.key} className="relative flex gap-4 py-2.5">
                    <span className="relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-[rgb(var(--bg))] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1 pt-1">
                      {/* ONE line at every width: the verb and the parent title
                          truncate so the time always stays inline at the right
                          edge — a wrapping row put it on its own line for long
                          titles only, and the column went ragged on phones. */}
                      <div className="flex items-baseline gap-x-2">
                        <span
                          className={`truncate text-xs text-muted ${hasParent ? 'max-w-[55%] shrink-0' : 'min-w-0'}`}
                        >
                          {t(`ov_verb_${item.kind}`)}
                        </span>
                        {hasParent && (
                          <span
                            title={item.context || undefined}
                            className="min-w-0 flex-1 truncate text-xs text-zinc-600 dark:text-zinc-400"
                          >
                            {item.context || t('ov_untitled_post')}
                          </span>
                        )}
                        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted">
                          {relativeTime(item.at, locale)}
                        </span>
                      </div>
                      <Link
                        href={item.href}
                        className={`mt-0.5 block text-sm leading-snug decoration-zinc-300 underline-offset-2 hover:underline dark:decoration-zinc-600 ${
                          isComment ? 'line-clamp-2 text-zinc-700 dark:text-zinc-300' : 'line-clamp-1 font-medium'
                        }`}
                      >
                        {item.title || t('ov_untitled_post')}
                      </Link>
                      {!isComment && item.context && (
                        <p className="mt-0.5 truncate text-xs text-muted">{item.context}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>

      {/* Right rail. Below lg the rail dissolves into the page grid
          (`display: contents`) so 关于我 — short identity context — can move
          ABOVE 精选 and the long 最近动态 feed, while 板块一览 stays last. */}
      <aside className="min-w-0 max-lg:contents lg:sticky lg:top-[calc(var(--nav-offset,68px)+16px)] lg:space-y-4 lg:self-start">
        {(aboutMd || viewer.isOwner) && (
          <div className="surface min-w-0 rounded-2xl p-5 max-lg:order-first">
            <h2 className="flex items-center justify-between text-sm font-semibold tracking-tight">
              {t('ov_about_title')}
              {viewer.isOwner && (
                <Link
                  href="/settings"
                  aria-label={t('page_edit_profile')}
                  title={t('page_edit_profile')}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  <PenLine className="h-3.5 w-3.5" aria-hidden />
                </Link>
              )}
            </h2>
            {aboutMd ? (
              <div className="mt-3 break-words">
                <MarkdownRenderer content={aboutMd} size="compact" />
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted">
                {t('ov_about_owner_empty')}{' '}
                <Link href="/settings" className="font-medium text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-100">
                  {t('ov_about_cta')}
                </Link>
              </p>
            )}
          </div>
        )}

        {indexSections.length > 0 && (
          <nav aria-label={t('ov_sections_title')} className="surface min-w-0 rounded-2xl p-2">
            <h2 className="px-3 pb-1 pt-3 text-sm font-semibold tracking-tight">{t('ov_sections_title')}</h2>
            <ul>
              {indexSections.map((s) => (
                <SectionIndexRow
                  key={s}
                  section={s}
                  count={counts[s]}
                  hidden={isHiddenButVisible(viewer, s)}
                  href={profileHref(handle, { tab: s, visitor })}
                  label={t(`tab_${s}`)}
                  hiddenLabel={t('hidden_badge')}
                />
              ))}
            </ul>
          </nav>
        )}
      </aside>
    </div>
  );
}

function SectionTitle({ id, icon: Icon, children }: { id: string; icon: LucideIcon | null; children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <h2 id={id} className="inline-flex items-center gap-2 text-base font-semibold tracking-tight">
        {Icon && <Icon className="h-4 w-4 rotate-45 text-zinc-400" aria-hidden />}
        {children}
      </h2>
      <span aria-hidden className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
    </div>
  );
}

function SectionIndexRow({
  section,
  count,
  hidden,
  href,
  label,
  hiddenLabel,
}: {
  section: ProfileSection;
  count: number;
  hidden: boolean;
  href: string;
  label: string;
  hiddenLabel: string;
}) {
  const Icon = SECTION_ICONS[section];
  return (
    <li>
      <Link
        href={href}
        scroll={false}
        className="group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800/70"
      >
        <Icon className="h-4 w-4 shrink-0 text-zinc-400 transition-colors group-hover:text-zinc-700 dark:group-hover:text-zinc-200" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {hidden && (
          <span title={hiddenLabel} aria-label={hiddenLabel}>
            <EyeOff className="h-3.5 w-3.5 text-zinc-400" aria-hidden />
          </span>
        )}
        <span className="font-mono text-xs tabular-nums text-muted">{count}</span>
        <ChevronRight className="h-3.5 w-3.5 text-zinc-300 transition-transform group-hover:translate-x-0.5 dark:text-zinc-600" aria-hidden />
      </Link>
    </li>
  );
}
