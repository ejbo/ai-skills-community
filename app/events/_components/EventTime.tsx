'use client';

// Viewer-local time display. Timed events store real UTC instants + the
// organizer's zone; this component renders them converted to the BROWSER's
// timezone. SSR/first client render deterministically shows the event's own
// zone; a post-hydration effect swaps in the viewer zone (no hydration
// mismatch). When the two zones render differently, the event-zone original is
// appended (card) or shown as a second line (detail) so "北京 14:00" context
// isn't lost. All-day events are date-only and never converted.

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  dayKey,
  fmtDateFull,
  fmtDateShort,
  fmtEventRange,
  fmtTime,
  sameUtcDay,
  toWallDate,
} from '@/lib/events/time';
import { DEFAULT_EVENT_TIMEZONE, TZ_SHORT } from '@/lib/events/types';

// 时区短名（东部/中部/西部/北京）的 i18n key —— 入库值仍是 IANA zone。
const TZ_SHORT_KEY: Record<string, string> = {
  'America/Toronto': 'tz_eastern',
  'America/Edmonton': 'tz_central',
  'America/Vancouver': 'tz_western',
  'Asia/Shanghai': 'tz_beijing',
};

/** Translator handle passed into the pure label helpers below. */
type T = ReturnType<typeof useTranslations>;

function zoneShort(t: T, zone: string): string {
  const key = TZ_SHORT_KEY[zone];
  return key && TZ_SHORT[zone] ? t(key) : '';
}

function useViewerZone(): string | null {
  const [zone, setZone] = useState<string | null>(null);
  useEffect(() => {
    try {
      setZone(Intl.DateTimeFormat().resolvedOptions().timeZone || null);
    } catch {
      /* keep event zone */
    }
  }, []);
  return zone;
}

interface TimeProps {
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  timezone: string | null;
}

function allDaySpanLabel(t: T, start: Date, end: Date | null, withDate: boolean): string {
  if (end && !sameUtcDay(start, end)) {
    const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
    const sameMonth = sameYear && start.getUTCMonth() === end.getUTCMonth();
    const endText = sameMonth
      ? t('day_of_month', { day: end.getUTCDate() })
      : sameYear
        ? fmtDateShort(end)
        : fmtDateFull(end);
    const startText = sameYear ? fmtDateShort(start) : fmtDateFull(start);
    return t('all_day_range', { start: startText, end: endText });
  }
  return withDate ? t('all_day_on', { date: fmtDateShort(start) }) : t('all_day');
}

/** Compact one-liner for list cards: viewer-local time + event-zone original. */
export function EventTimeCard({ startAt, endAt, allDay, timezone, showDate = false }: TimeProps & { showDate?: boolean }) {
  const t = useTranslations('events');
  const viewerZone = useViewerZone();
  const start = new Date(startAt);
  const end = endAt ? new Date(endAt) : null;
  if (allDay) return <>{allDaySpanLabel(t, start, end, showDate)}</>;

  const eventZone = timezone ?? DEFAULT_EVENT_TIMEZONE;
  const zone = viewerZone ?? eventZone;
  const ls = toWallDate(start, zone);
  const le = end ? toWallDate(end, zone) : null;
  const es = toWallDate(start, eventZone);

  // 跨天/换日：本地日期偏离活动本地日期时补上日期，避免归组标签误导。
  const datePrefix =
    showDate || dayKey(ls) !== dayKey(es) ? `${fmtDateShort(ls)} ` : '';
  let label: string;
  if (le) {
    label = sameUtcDay(ls, le)
      ? `${datePrefix}${fmtTime(ls)} – ${fmtTime(le)}`
      : `${fmtDateShort(ls)} ${fmtTime(ls)} – ${fmtDateShort(le)} ${fmtTime(le)}`;
  } else {
    label = `${datePrefix}${fmtTime(ls)}`;
  }
  const differs = fmtTime(ls) !== fmtTime(es) || dayKey(ls) !== dayKey(es);
  return (
    <>
      {label}
      {differs && (
        <span className="font-normal text-muted">
          {t('zone_time_paren', { zone: zoneShort(t, eventZone), time: fmtTime(es) })}
        </span>
      )}
    </>
  );
}

/** Two-line block for the detail page date card. */
export function EventTimeDetail({ startAt, endAt, allDay, timezone }: TimeProps) {
  const t = useTranslations('events');
  const viewerZone = useViewerZone();
  const start = new Date(startAt);
  const end = endAt ? new Date(endAt) : null;
  if (allDay) {
    return <div className="font-medium">{fmtEventRange(start, end, true)}</div>;
  }
  const eventZone = timezone ?? DEFAULT_EVENT_TIMEZONE;
  const zone = viewerZone ?? eventZone;
  const ls = toWallDate(start, zone);
  const le = end ? toWallDate(end, zone) : null;
  const es = toWallDate(start, eventZone);
  const ee = end ? toWallDate(end, eventZone) : null;
  const differs = ls.getTime() !== es.getTime();
  return (
    <div>
      <div className="font-medium">{fmtEventRange(ls, le, false)}</div>
      {differs ? (
        <div className="mt-0.5 text-xs text-muted">
          {t('zone_time_line', {
            zone: zoneShort(t, eventZone),
            time: `${fmtDateShort(es)} ${fmtTime(es)}${
              ee ? ` – ${sameUtcDay(es, ee) ? '' : `${fmtDateShort(ee)} `}${fmtTime(ee)}` : ''
            }`,
          })}
        </div>
      ) : (
        <div className="mt-0.5 text-xs text-muted">
          {t('local_zone_note', { zone: zoneShort(t, eventZone) })}
        </div>
      )}
    </div>
  );
}

/** Time cell for the 本月活动 agenda; continuation days render 续. */
export function EventTimeAgenda({
  startAt,
  allDay,
  timezone,
  startDayKey,
  entryDayKey,
}: {
  startAt: string;
  allDay: boolean;
  timezone: string | null;
  startDayKey: string;
  entryDayKey: string;
}) {
  const t = useTranslations('events');
  const viewerZone = useViewerZone();
  if (entryDayKey !== startDayKey) return <>{t('continued')}</>;
  if (allDay) return <>{t('all_day')}</>;
  const eventZone = timezone ?? DEFAULT_EVENT_TIMEZONE;
  const zone = viewerZone ?? eventZone;
  return <>{fmtTime(toWallDate(new Date(startAt), zone))}</>;
}
