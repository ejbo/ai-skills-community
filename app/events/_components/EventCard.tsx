// 活动卡片 (server component) — Luma-style row card: time line (viewer-local via
// the EventTimeCard client leaf), title, 主讲人, location row, badges, square
// cover thumbnail. The whole card is a stretched link; inner links (官网) sit
// above it with relative z-10.

import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { CalendarCheck2, ExternalLink, MapPin, Users, Video } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { withBasePath } from '@/lib/base-path';
import { eventLinkHref, type PublicEventItem } from '@/lib/events/types';
import { eventOverAt } from '@/lib/events/time';
import { CancelledBadge, KindBadge, ModeBadge, TopicChip } from './badges';
import { CardAttendButton } from './CardAttendButton';
import { EventTimeCard } from './EventTime';
import { ImageLightbox } from './ImageLightbox';

export async function EventCard({ event, showDate = false }: { event: PublicEventItem; showDate?: boolean }) {
  const t = await getTranslations('events');
  const location =
    event.mode === 'online' ? t('online_event') : [event.venue, event.city].filter(Boolean).join(' · ');
  const websiteHref = eventLinkHref(event.websiteUrl);
  const joinable =
    !event.cancelled &&
    eventOverAt(event.startAt, event.endAt, event.allDay, event.timezone).getTime() > Date.now();
  return (
    // 我要参加的活动：accent 边框 + 徽章，让「这是我加入的」一眼可辨。
    <article
      className={`card-hover surface relative flex gap-4 rounded-2xl p-4 ${
        event.attending ? '!border-zinc-900/40 dark:border-zinc-100/40 ring-1 ring-zinc-900/25 dark:ring-zinc-100/25' : ''
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
          <span className="font-medium tabular-nums">
            <EventTimeCard
              startAt={event.startAt}
              endAt={event.endAt}
              allDay={event.allDay}
              timezone={event.timezone}
              showDate={showDate}
            />
          </span>
          {event.cancelled && <CancelledBadge />}
          {event.attending && !joinable && (
            <span className="inline-flex items-center gap-1 rounded-full bg-zinc-900/[0.06] dark:bg-white/10 px-2 py-0.5 text-[11px] font-medium text-zinc-900 dark:text-zinc-50">
              <CalendarCheck2 className="h-3 w-3" />
              {t('attending_badge')}
            </span>
          )}
          {joinable && <CardAttendButton id={event.id} attending={event.attending} />}
        </div>
        <h3 className={`mt-1 truncate text-base font-semibold ${event.cancelled ? 'text-muted line-through' : ''}`}>
          <Link href={`/events/${event.id}`} className="after:absolute after:inset-0">
            {event.title}
          </Link>
        </h3>
        {event.summary && <p className="mt-0.5 line-clamp-1 text-sm text-muted">{event.summary}</p>}

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Avatar name={event.author.displayName} src={event.author.avatarUrl} size="xs" handle={event.author.handle} />
            <span className="max-w-[10rem] truncate">{event.author.displayName}</span>
            {/* Above the title's stretched-link overlay (after:inset-0) so the truncated tag can still show its tooltip. */}
            <DeptTag department={event.author.department} lab={event.author.lab} className="relative z-[1]" />
          </span>
          {event.speakers.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <span className="flex -space-x-1.5">
                {event.speakers.slice(0, 4).map((s, i) => (
                  <span key={i} className="rounded-full ring-2 ring-white dark:ring-zinc-950">
                    <Avatar name={s.name} src={s.avatarUrl || null} size="xs" />
                  </span>
                ))}
              </span>
              <span>
                {event.speakers.length > 1
                  ? t('speaker_lead_more', {
                      name: event.speakers[0].name,
                      count: event.speakers.length,
                    })
                  : t('speaker_lead', { name: event.speakers[0].name })}
              </span>
            </span>
          )}
          {location && (
            <span className="inline-flex items-center gap-1">
              {event.mode === 'online' ? <Video className="h-3.5 w-3.5" /> : <MapPin className="h-3.5 w-3.5" />}
              <span className="max-w-[14rem] truncate">{location}</span>
            </span>
          )}
          {event.attendeeCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              {t('attendee_count', { count: event.attendeeCount })}
            </span>
          )}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <KindBadge kind={event.kind} />
          <ModeBadge mode={event.mode} />
          {event.topics.map((tp) => (
            <TopicChip key={tp} topic={tp} />
          ))}
          {websiteHref && (
            <a
              href={websiteHref}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="relative z-10 inline-flex items-center gap-1 rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] text-zinc-500 transition hover:border-zinc-400 dark:hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400"
            >
              <ExternalLink className="h-3 w-3" />
              {t('website_signup')}
            </a>
          )}
        </div>
      </div>
      {event.coverUrl && (
        <ImageLightbox src={event.coverUrl} alt={event.title} className="hidden shrink-0 self-start sm:block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={withBasePath(event.coverUrl)}
            alt=""
            loading="lazy"
            className="h-24 w-24 rounded-xl object-cover"
            style={event.coverPos ? { objectPosition: event.coverPos } : undefined}
          />
        </ImageLightbox>
      )}
    </article>
  );
}
