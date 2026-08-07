// 活动详情 — Luma-style two-column: main content (cover, badges, title,
// 活动介绍, 讲师/嘉宾, 发布者) + sticky right rail (时间卡片 with 添加到日历,
// 地点/参与 card with the member-only meeting link, owner/admin actions).

import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CalendarDays, CalendarPlus, ExternalLink, Link2, MapPin, Users, Video } from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { Avatar } from '@/components/Avatar';
import { BackButton } from '@/components/BackButton';
import { DeptTag } from '@/components/DeptTag';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { withBasePath } from '@/lib/base-path';
import { getEventDetail } from '@/lib/event-queries';
import { toWallDate } from '@/lib/events/time';
import { DEFAULT_EVENT_TIMEZONE, eventLinkHref } from '@/lib/events/types';
import { AddToCalendar } from '../_components/AddToCalendar';
import { AttendButton } from '../_components/AttendButton';
import { EventActions } from '../_components/EventActions';
import { EventTimeDetail } from '../_components/EventTime';
import { CancelledBadge, KindBadge, ModeBadge, TopicChip } from '../_components/badges';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const t = await getTranslations('event_form');
  const row = await prisma.event.findFirst({
    where: { id: params.id, deletedAt: null },
    select: { title: true },
  });
  return { title: row ? t('meta_detail', { title: row.title }) : t('meta_detail_fallback') };
}

export default async function EventDetailPage({ params }: { params: { id: string } }) {
  const t = await getTranslations('event_form');
  const tl = await getTranslations('labels');
  const session = await auth();
  const viewer = { id: session?.user?.id ?? null, isAdmin: Boolean(session?.user?.isAdmin) };
  const event = await getEventDetail(params.id, viewer);
  if (!event) notFound();

  const start = new Date(event.startAt);
  // 日历角标显示活动本地日期（定时活动按其时区，全天活动按存储日期）。
  const chipDate = event.allDay ? start : toWallDate(start, event.timezone ?? DEFAULT_EVENT_TIMEZONE);
  const showLocation = event.mode !== 'online' && (event.venue || event.city);
  const icsHref = withBasePath(`/api/events/${event.id}/ics`);
  const meetingHref = eventLinkHref(event.meetingUrl);
  const websiteHref = eventLinkHref(event.websiteUrl);
  // Same "over" rule as the attend route: all-day rows run through end-of-date.
  const effEnd = new Date(event.endAt ?? event.startAt).getTime();
  const isOver = (event.allDay ? effEnd + 24 * 60 * 60 * 1000 : effEnd) < Date.now();
  const te = await getTranslations('events');

  return (
    <div className="container max-w-6xl py-8">
      <div className="mb-4">
        <BackButton fallbackHref="/events" label={t('back_to_events')} />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ── main column ── */}
        <div className="min-w-0">
          {event.coverUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={withBasePath(event.coverUrl)}
              alt=""
              className="mb-5 aspect-[2/1] w-full rounded-2xl object-cover"
            />
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            <KindBadge kind={event.kind} />
            <ModeBadge mode={event.mode} />
            {event.topics.map((tp) => (
              <TopicChip key={tp} topic={tp} />
            ))}
            {event.cancelled && <CancelledBadge />}
            {event.pinned && (
              <span className="inline-flex items-center rounded-full bg-accent-500/10 px-2 py-0.5 text-[11px] font-medium text-accent-600 dark:text-accent-400">
                {t('pinned_badge')}
              </span>
            )}
          </div>

          <h1
            className={`mt-3 text-2xl font-bold tracking-tight sm:text-3xl ${
              event.cancelled ? 'text-muted line-through' : ''
            }`}
          >
            {event.title}
          </h1>
          {event.summary && <p className="mt-2 text-[15px] text-muted">{event.summary}</p>}

          <div className="mt-4 flex items-center gap-2 text-sm">
            <Link
              href={`/users/${event.author.handle}`}
              className="flex items-center gap-2 transition hover:opacity-80"
            >
              <Avatar name={event.author.displayName} src={event.author.avatarUrl} size="sm" />
              <span className="font-medium">{event.author.displayName}</span>
            </Link>
            <DeptTag department={event.author.department} lab={event.author.lab} />
            <span className="text-xs text-muted">{t('organizer_label')}</span>
          </div>

          {event.descriptionMd.trim() && (
            <section className="mt-8">
              <h2 className="mb-3 text-lg font-semibold">{t('f_description')}</h2>
              <MarkdownRenderer content={event.descriptionMd} />
            </section>
          )}

          {event.speakers.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-3 text-lg font-semibold">{t('speakers_heading')}</h2>
              <div className="space-y-3">
                {event.speakers.map((s, i) => (
                  <div key={i} className="surface flex gap-4 rounded-2xl p-4 sm:gap-5 sm:p-5">
                    {s.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={withBasePath(s.avatarUrl)}
                        alt={s.name}
                        className="h-24 w-24 shrink-0 rounded-xl object-cover sm:h-28 sm:w-28"
                      />
                    ) : (
                      <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl bg-accent-500/10 text-3xl font-semibold text-accent-600 sm:h-28 sm:w-28">
                        {s.name.slice(0, 1)}
                      </div>
                    )}
                    <div className="min-w-0 flex-1 py-0.5">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-base font-semibold">{s.name}</span>
                        {eventLinkHref(s.link) && (
                          <a
                            href={eventLinkHref(s.link)!}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            aria-label={t('speaker_homepage', { name: s.name })}
                            className="text-muted transition hover:text-accent-600"
                          >
                            <Link2 className="h-4 w-4" />
                          </a>
                        )}
                      </div>
                      {(s.title || s.org) && (
                        <p className="mt-1 text-sm text-muted">
                          {[s.title, s.org].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      {s.bio && (
                        <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                          {s.bio}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* ── right rail ── */}
        <aside>
          <div className="sticky top-20 space-y-4">
            {/* Joinable while live; an ATTENDING viewer keeps the card even after
                取消/结束 so they can still leave (clean up 我参加的). */}
            {(event.attending || (!event.cancelled && !isOver)) && (
              <div className="surface rounded-2xl p-5">
                {session?.user ? (
                  <AttendButton
                    id={event.id}
                    attending={event.attending}
                    attendeeCount={event.attendeeCount}
                  />
                ) : (
                  <div>
                    <Link
                      href={`/auth/login?callbackUrl=${encodeURIComponent(`/events/${event.id}`)}`}
                      className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-accent-500 text-sm font-medium text-white transition hover:bg-accent-600"
                    >
                      <CalendarPlus className="h-4 w-4" />
                      {te('attend_login')}
                    </Link>
                    <p className="mt-1.5 flex items-center justify-center gap-1 text-xs text-muted">
                      <Users className="h-3.5 w-3.5" />
                      {te('attendee_count', { count: event.attendeeCount })}
                    </p>
                  </div>
                )}
              </div>
            )}
            <div className="surface rounded-2xl p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
                  <span className="w-full bg-zinc-100 text-center text-[9px] font-medium uppercase text-muted dark:bg-zinc-800">
                    {t('month_chip', { m: chipDate.getUTCMonth() + 1 })}
                  </span>
                  <span className="flex flex-1 items-center text-sm font-semibold">{chipDate.getUTCDate()}</span>
                </div>
                <div className="min-w-0 text-sm">
                  <EventTimeDetail
                    startAt={event.startAt}
                    endAt={event.endAt}
                    allDay={event.allDay}
                    timezone={event.timezone}
                  />
                  {event.cancelled && (
                    <div className="mt-0.5 text-xs text-red-500">{t('cancelled_notice')}</div>
                  )}
                </div>
              </div>
              <div className="mt-4">
                <AddToCalendar
                  id={event.id}
                  title={event.title}
                  cancelled={event.cancelled}
                  startAt={event.startAt}
                  endAt={event.endAt}
                  allDay={event.allDay}
                  venue={event.venue}
                  city={event.city}
                  summary={event.summary}
                  icsHref={icsHref}
                />
              </div>
            </div>

            <div className="surface space-y-3 rounded-2xl p-5 text-sm">
              <div className="flex items-start gap-2.5">
                {event.mode === 'online' ? (
                  <Video className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                ) : (
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                )}
                <div className="min-w-0">
                  <div className="font-medium">{tl(`eventMode.${event.mode}`)}</div>
                  {showLocation && (
                    <p className="mt-0.5 text-[13px] text-muted">
                      {[event.venue, event.city].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
              </div>
              {meetingHref ? (
                <a
                  href={meetingHref}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-accent-500 text-sm font-medium text-white transition hover:bg-accent-600"
                >
                  <Video className="h-4 w-4" />
                  {t('join_online')}
                </a>
              ) : (
                !session?.user &&
                event.mode !== 'offline' && (
                  <p className="text-xs text-muted">
                    {t.rich('login_to_see_meeting', {
                      link: (chunks) => (
                        <Link
                          href={`/auth/login?callbackUrl=${encodeURIComponent(`/events/${event.id}`)}`}
                          className="text-accent-600 underline-offset-2 hover:underline"
                        >
                          {chunks}
                        </Link>
                      ),
                    })}
                  </p>
                )
              )}
              {websiteHref && (
                <a
                  href={websiteHref}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-200 text-sm font-medium text-zinc-700 transition hover:border-accent-500 hover:text-accent-600 dark:border-zinc-700 dark:text-zinc-200"
                >
                  <ExternalLink className="h-4 w-4" />
                  {t('website_page')}
                </a>
              )}
            </div>

            {event.isOwner && (
              <div className="surface rounded-2xl p-4">
                <h3 className="mb-2.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {t('manage_event')}
                </h3>
                <EventActions
                  id={event.id}
                  pinned={event.pinned}
                  cancelled={event.cancelled}
                  isAuthor={event.isAuthor}
                  isAdmin={viewer.isAdmin}
                />
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
