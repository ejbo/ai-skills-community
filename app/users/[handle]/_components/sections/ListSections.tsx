// 个人主页 section tabs rendered as ROW LISTS: 动态 · 话题 · 专区 · 活动 · 反馈 · 评论.
// Rows are denser than cards on purpose — these are text-first surfaces, and a
// member with forty posts should scan, not scroll past forty tiles.

import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Eye, FileText, Heart, MessageCircle, MessageSquare, Play, ThumbsUp } from 'lucide-react';
import { withBasePath } from '@/lib/base-path';
import { relativeTime } from '@/lib/i18n-date';
import {
  loadCommentsSection,
  loadEventsSection,
  loadFeedbackSection,
  loadPostsSection,
  loadTopicsSection,
  loadZonesSection,
} from '@/lib/profile/queries';
import { PostRow } from '@/app/zones/_components/PostRow';
import { EventCard } from '@/app/events/_components/EventCard';
import { CategoryChipStatic, LockedBadge, PinnedBadge } from '@/app/discussion/_components/badges';
import { CategoryChip as FeedbackCategoryChip, StatusBadge } from '@/app/feedback/_components/badges';
import { StaggerChildren } from '../StaggerChildren';
import { CursorPager, OffsetPager, OwnerItem, SectionEmpty, SectionHeader } from './SectionShell';
import { SECTION_ICONS } from '../section-meta';
import type { SectionProps } from './GridSections';
import { isHiddenButVisible } from '@/lib/profile/queries';
import { pinKey, type PinKind, type ProfileSection } from '@/lib/profile/shared';
import { eventHref, feedbackHref, topicHref } from '@/lib/slug-href';

function pinFor(props: SectionProps, kind: PinKind, id: string) {
  return { kind, id, pinned: props.pinnedKeys.includes(pinKey({ kind, id })) };
}

function header(props: SectionProps, section: ProfileSection, total: number | null, empty: boolean) {
  return (
    <SectionHeader
      section={section}
      total={total}
      hiddenFromPublic={isHiddenButVisible(props.viewer, section)}
      isOwner={props.viewer.isOwner}
      empty={empty}
    />
  );
}

const ROW_LIST = 'surface divide-y divide-zinc-100 rounded-2xl dark:divide-zinc-800/70';
const ROW_LINK = 'block rounded-2xl px-4 py-4 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/60 sm:px-5';

function Figure({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono tabular-nums">
      {icon}
      {children}
    </span>
  );
}

export async function PostsSection(props: SectionProps) {
  const { viewer, handle } = props;
  const [t, locale] = await Promise.all([getTranslations('profile'), getLocale()]);
  const res = await loadPostsSection(viewer, props.page);
  return (
    <section>
      {header(props, 'posts', res.total, res.total === 0)}
      {res.total === 0 ? (
        viewer.isOwner && <SectionEmpty section="posts" />
      ) : (
        <ul className={ROW_LIST}>
          {res.items.map((p) => (
            <li key={p.id}>
              <OwnerItem enabled={viewer.isOwner} pin={pinFor(props, 'post', p.id)} placement="side" className={viewer.isOwner ? 'pr-3' : ''}>
                <Link href={`/discussion/posts/${p.id}`} className={ROW_LINK}>
                  {p.excerpt ? (
                    <p className="line-clamp-3 text-[15px] leading-relaxed">{p.excerpt}</p>
                  ) : (
                    <p className="text-sm text-muted">{t('ov_untitled_post')}</p>
                  )}
                  {p.thumbs.length > 0 && (
                    <div className="mt-3 flex gap-2">
                      {p.thumbs.map((m, i) => (
                        <span
                          key={i}
                          className="relative h-20 w-28 overflow-hidden rounded-lg bg-zinc-100 ring-1 ring-black/5 dark:bg-zinc-900 dark:ring-white/10"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- stored root-relative media */}
                          <img src={withBasePath(m.url)} alt="" loading="lazy" className="h-full w-full object-cover" />
                          {m.kind === 'video' && (
                            <span className="absolute inset-0 flex items-center justify-center bg-black/20">
                              <Play className="h-5 w-5 text-white drop-shadow" fill="currentColor" aria-hidden />
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    <Figure icon={<Heart className="h-3 w-3" aria-hidden />}>{t('n_likes', { count: p.likeCount })}</Figure>
                    <Figure icon={<MessageCircle className="h-3 w-3" aria-hidden />}>
                      {t('n_comments', { count: p.commentCount })}
                    </Figure>
                    {p.fileCount > 0 && (
                      <Figure icon={<FileText className="h-3 w-3" aria-hidden />}>{t('sec_n_files', { count: p.fileCount })}</Figure>
                    )}
                    <span className="ml-auto">{relativeTime(p.createdAt, locale)}</span>
                  </p>
                </Link>
              </OwnerItem>
            </li>
          ))}
        </ul>
      )}
      <OffsetPager handle={handle} section="posts" page={res.page} pageCount={res.pageCount} visitor={viewer.previewAsVisitor} />
    </section>
  );
}

export async function TopicsSection(props: SectionProps) {
  const { viewer, handle } = props;
  const [t, locale] = await Promise.all([getTranslations('profile'), getLocale()]);
  const res = await loadTopicsSection(viewer, props.page);
  return (
    <section>
      {header(props, 'topics', res.total, res.total === 0)}
      {res.total === 0 ? (
        viewer.isOwner && <SectionEmpty section="topics" />
      ) : (
        <ul className={ROW_LIST}>
          {res.items.map((topic) => (
            <li key={topic.id}>
              <OwnerItem
                enabled={viewer.isOwner}
                pin={pinFor(props, 'topic', topic.id)}
                editHref={`${topicHref(topic)}/edit`}
                placement="side"
                className={viewer.isOwner ? 'pr-3' : ''}
              >
                <Link href={topicHref(topic)} className={ROW_LINK}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {topic.pinned && <PinnedBadge />}
                    {topic.locked && <LockedBadge />}
                    {topic.tags.slice(0, 4).map((tag) => (
                      <CategoryChipStatic key={tag.slug} tag={tag} />
                    ))}
                  </div>
                  <h3 className="mt-2 line-clamp-2 text-base font-semibold leading-snug tracking-tight">{topic.title}</h3>
                  {topic.excerpt && <p className="mt-1 line-clamp-2 text-sm text-muted">{topic.excerpt}</p>}
                  <p className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    <Figure icon={<MessageSquare className="h-3 w-3" aria-hidden />}>
                      {t('n_replies', { count: topic.replyCount })}
                    </Figure>
                    <Figure icon={<ThumbsUp className="h-3 w-3" aria-hidden />}>
                      {t('sec_n_upvotes', { count: topic.upvoteCount })}
                    </Figure>
                    <Figure icon={<Eye className="h-3 w-3" aria-hidden />}>{t('n_views', { count: topic.viewCount })}</Figure>
                    <span className="ml-auto">{relativeTime(topic.createdAt, locale)}</span>
                  </p>
                </Link>
              </OwnerItem>
            </li>
          ))}
        </ul>
      )}
      <OffsetPager handle={handle} section="topics" page={res.page} pageCount={res.pageCount} visitor={viewer.previewAsVisitor} />
    </section>
  );
}

export async function ZonesSection(props: SectionProps) {
  const { viewer, handle, cursor } = props;
  const res = await loadZonesSection(viewer, cursor);
  const empty = res.items.length === 0 && !cursor;
  return (
    <section>
      {header(props, 'zones', props.counts.zones, empty)}
      {empty ? (
        viewer.isOwner && <SectionEmpty section="zones" />
      ) : (
        <div className="surface rounded-2xl px-4 py-1 sm:px-6">
          {res.items.map((p) => (
            <OwnerItem
              key={p.id}
              enabled={viewer.isOwner}
              pin={pinFor(props, 'zonePost', p.id)}
              placement="side"
              className="border-b border-zinc-200 last:border-b-0 dark:border-zinc-800 [&_article]:border-b-0"
            >
              <PostRow post={p} showZone />
            </OwnerItem>
          ))}
        </div>
      )}
      <CursorPager handle={handle} section="zones" cursor={cursor} nextCursor={res.nextCursor} visitor={viewer.previewAsVisitor} />
    </section>
  );
}

export async function EventsSection(props: SectionProps) {
  const { viewer, handle } = props;
  const res = await loadEventsSection(viewer, props.page);
  return (
    <section>
      {header(props, 'events', res.total, res.total === 0)}
      {res.total === 0 ? (
        viewer.isOwner && <SectionEmpty section="events" />
      ) : (
        <StaggerChildren className="grid gap-3 lg:grid-cols-2" itemClassName="min-w-0">
          {res.items.map((e) => (
            <OwnerItem
              key={e.id}
              enabled={viewer.isOwner}
              pin={pinFor(props, 'event', e.id)}
              editHref={e.isAuthor ? `${eventHref(e)}/edit` : null}
              className="h-full [&>article]:h-full"
            >
              <EventCard event={e} showDate />
            </OwnerItem>
          ))}
        </StaggerChildren>
      )}
      <OffsetPager handle={handle} section="events" page={res.page} pageCount={res.pageCount} visitor={viewer.previewAsVisitor} />
    </section>
  );
}

export async function FeedbackSection(props: SectionProps) {
  const { viewer, handle } = props;
  const [t, locale] = await Promise.all([getTranslations('profile'), getLocale()]);
  const res = await loadFeedbackSection(viewer, props.page);
  return (
    <section>
      {header(props, 'feedback', res.total, res.total === 0)}
      {res.total === 0 ? (
        viewer.isOwner && <SectionEmpty section="feedback" />
      ) : (
        <ul className={ROW_LIST}>
          {res.items.map((f) => (
            <li key={f.id}>
              <Link href={feedbackHref(f)} className={`${ROW_LINK} flex items-center gap-4`}>
                <span className="flex w-12 shrink-0 flex-col items-center rounded-lg border border-zinc-200 py-1.5 dark:border-zinc-800">
                  <ThumbsUp className="h-3.5 w-3.5 text-muted" aria-hidden />
                  <span className="mt-0.5 font-mono text-sm font-semibold tabular-nums">{f.upvoteCount}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate text-sm font-medium">{f.title}</span>
                    <FeedbackCategoryChip category={f.category} />
                    <StatusBadge status={f.status} />
                  </span>
                  <span className="mt-1 flex items-center gap-3 text-xs text-muted">
                    <Figure icon={<MessageSquare className="h-3 w-3" aria-hidden />}>
                      {t('n_comments', { count: f.commentCount })}
                    </Figure>
                    <span>{relativeTime(f.createdAt, locale)}</span>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <OffsetPager handle={handle} section="feedback" page={res.page} pageCount={res.pageCount} visitor={viewer.previewAsVisitor} />
    </section>
  );
}

export async function CommentsSection(props: SectionProps) {
  const { viewer, handle, cursor } = props;
  const [t, locale] = await Promise.all([getTranslations('profile'), getLocale()]);
  const res = await loadCommentsSection(viewer, cursor);
  const empty = res.items.length === 0 && !cursor;
  const Icon = SECTION_ICONS.comments;
  return (
    <section>
      {header(props, 'comments', props.counts.comments, empty)}
      {empty ? (
        viewer.isOwner && <SectionEmpty section="comments" />
      ) : (
        <ul className={ROW_LIST}>
          {res.items.map((c) => {
            const title = c.contextTitle || t('ov_untitled_post');
            return (
              <li key={c.key}>
                <Link href={c.href} className={`${ROW_LINK} flex items-start gap-3`}>
                  <Icon className="mt-1 h-4 w-4 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-3 text-sm leading-relaxed">{c.excerpt}</span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                      <span className="min-w-0 truncate">
                        {c.kind === 'feedback_comment'
                          ? t('sec_kind_feedback_comment', { title })
                          : t(`kind_${c.kind}`, { title })}
                      </span>
                      <span aria-hidden>·</span>
                      <span className="shrink-0">{relativeTime(c.createdAt, locale)}</span>
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <CursorPager handle={handle} section="comments" cursor={cursor} nextCursor={res.nextCursor} visitor={viewer.previewAsVisitor} />
    </section>
  );
}
