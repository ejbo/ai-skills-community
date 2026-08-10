import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { BackButton } from '@/components/BackButton';
import { dayKey, fmtTime, toWallDate } from '@/lib/events/time';
import { DEFAULT_EVENT_TIMEZONE } from '@/lib/events/types';
import { EventForm, type EventFormInitial } from '../../_components/EventForm';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('event_form');
  return { title: t('meta_edit') };
}

// Content edits are AUTHOR-only (the PATCH route enforces the same rule);
// admins moderate via the inline actions on the detail page instead.
export default async function EditEventPage({ params }: { params: { id: string } }) {
  const t = await getTranslations('event_form');
  const session = await auth();
  if (!session?.user) redirect(`/auth/login?callbackUrl=${encodeURIComponent(`/events/${params.id}/edit`)}`);

  const row = await prisma.event.findFirst({
    where: { id: params.id, deletedAt: null },
    include: { speakers: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!row || row.authorId !== session.user.id) notFound();

  // Round-trip stored instants back into the organizer's picked zone — the
  // form edits wall times IN THAT ZONE, not UTC (all-day rows are date-only).
  const zone = row.timezone ?? DEFAULT_EVENT_TIMEZONE;
  const wallStart = row.allDay ? row.startAt : toWallDate(row.startAt, zone);
  const wallEnd = row.endAt ? (row.allDay ? row.endAt : toWallDate(row.endAt, zone)) : null;
  const initial: EventFormInitial = {
    title: row.title,
    summary: row.summary,
    descriptionMd: row.descriptionMd,
    kind: row.kind,
    topics: row.topics,
    mode: row.mode,
    startDate: dayKey(wallStart),
    startTime: row.allDay ? '' : fmtTime(wallStart),
    endDate: wallEnd ? dayKey(wallEnd) : '',
    endTime: wallEnd && !row.allDay ? fmtTime(wallEnd) : '',
    allDay: row.allDay,
    timezone: zone,
    venue: row.venue ?? '',
    city: row.city ?? '',
    meetingUrl: row.meetingUrl ?? '',
    websiteUrl: row.websiteUrl ?? '',
    coverUrl: row.coverUrl ?? '',
    coverPos: row.coverPos ?? '',
    speakers: row.speakers.map((s) => ({
      name: s.name,
      title: s.title,
      org: s.org,
      avatarUrl: s.avatarUrl,
      link: s.link,
      bio: s.bio,
    })),
  };

  return (
    <div className="container max-w-3xl py-8">
      <div className="mb-4">
        <BackButton fallbackHref={`/events/${row.id}`} label={t('back_to_events')} />
      </div>
      <h1 className="text-2xl font-bold tracking-tight">{t('edit_event_h1')}</h1>
      <p className="mt-1 text-sm text-muted">{t('edit_hint')}</p>
      <div className="mt-6">
        <EventForm eventId={row.id} initial={initial} />
      </div>
    </div>
  );
}
