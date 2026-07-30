'use client';

// 添加到日历 — Google Calendar template link (built on click so we can use
// window.location.origin for the absolute detail URL) + .ics download. The
// .ics covers Outlook/Apple users; per-vendor links aren't worth the drift.

import { CalendarPlus, Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { googleCalendarUrl } from '@/lib/events/calendar';

export function AddToCalendar({
  id,
  title,
  cancelled = false,
  startAt,
  endAt,
  allDay,
  venue,
  city,
  summary,
  icsHref,
}: {
  id: string;
  title: string;
  cancelled?: boolean;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  venue: string | null;
  city: string | null;
  summary: string;
  icsHref: string;
}) {
  const t = useTranslations('events');

  function openGoogle() {
    // icsHref is '<basePath>/api/events/<id>/ics' — derive the detail path from
    // it so the deploy basePath is carried without another prop.
    const detailPath = icsHref.replace(/\/api\/events\/(.+)\/ics$/, '/events/$1');
    const url = googleCalendarUrl({
      id,
      // 与 .ics 保持一致：已取消的活动带上前缀，别让人加进一条“看起来还活着”的日程。
      // The .ics route builds the same prefix from the same key, in the viewer's locale.
      title: cancelled ? t('cancelled_calendar_title', { title }) : title,
      startAt: new Date(startAt),
      endAt: endAt ? new Date(endAt) : null,
      allDay,
      venue,
      city,
      description: summary || undefined,
      url: `${window.location.origin}${detailPath}`,
    });
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  const btn =
    'inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 px-2 text-xs font-medium text-zinc-700 transition hover:border-accent-500 hover:text-accent-600 dark:border-zinc-700 dark:text-zinc-200';
  return (
    <div className="flex gap-2">
      <button type="button" onClick={openGoogle} className={btn}>
        <CalendarPlus className="h-3.5 w-3.5" />
        {t('google_calendar')}
      </button>
      <a href={icsHref} className={btn} download>
        <Download className="h-3.5 w-3.5" />
        {t('download_ics')}
      </a>
    </div>
  );
}
