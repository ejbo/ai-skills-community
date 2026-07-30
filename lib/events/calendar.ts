// "添加到日历" builders — Google Calendar template URL + RFC 5545 .ics.
// Client-safe (the Google link is built in the browser with window.origin).
//
// Timed events store REAL UTC instants, so both formats emit UTC (`Z`) times —
// Google/Outlook/Apple then convert to each attendee's own calendar timezone,
// matching the site's viewer-local display. All-day events use the date form
// with an EXCLUSIVE end (+1 day), per both the GCal param and DTEND;VALUE=DATE.

import { addDaysUtc } from '@/lib/events/time';

export interface CalendarEventInput {
  id: string;
  title: string;
  startAt: Date;
  endAt: Date | null;
  allDay: boolean;
  venue?: string | null;
  city?: string | null;
  /** Short plain-text description (summary + link, NOT the full markdown). */
  description?: string;
  /** Absolute detail-page URL. */
  url?: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** UTC basic form: YYYYMMDDTHHMMSSZ. */
function fmtInstant(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function fmtDate(d: Date): string {
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
}

/** Effective end: timed defaults to +1h; all-day end is EXCLUSIVE last-day+1. */
function effectiveEnd(ev: CalendarEventInput): Date {
  if (ev.allDay) return addDaysUtc(ev.endAt ?? ev.startAt, 1);
  return ev.endAt ?? new Date(ev.startAt.getTime() + 60 * 60 * 1000);
}

function locationOf(ev: CalendarEventInput): string {
  return [ev.venue, ev.city].filter(Boolean).join(', ');
}

export function googleCalendarUrl(ev: CalendarEventInput): string {
  const end = effectiveEnd(ev);
  const dates = ev.allDay
    ? `${fmtDate(ev.startAt)}/${fmtDate(end)}`
    : `${fmtInstant(ev.startAt)}/${fmtInstant(end)}`;
  const params = new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates });
  const details = [ev.description, ev.url].filter(Boolean).join('\n');
  if (details) params.set('details', details);
  const location = locationOf(ev);
  if (location) params.set('location', location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Escape per RFC 5545 §3.3.11 (TEXT): backslash, semicolon, comma, newline. */
function icsEscape(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

export function buildIcs(ev: CalendarEventInput): string {
  const end = effectiveEnd(ev);
  const stamp = fmtInstant(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ai-community//events//ZH',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${ev.id}@ai-community-events`,
    `DTSTAMP:${stamp}`,
    ev.allDay ? `DTSTART;VALUE=DATE:${fmtDate(ev.startAt)}` : `DTSTART:${fmtInstant(ev.startAt)}`,
    ev.allDay ? `DTEND;VALUE=DATE:${fmtDate(end)}` : `DTEND:${fmtInstant(end)}`,
    `SUMMARY:${icsEscape(ev.title)}`,
  ];
  const location = locationOf(ev);
  if (location) lines.push(`LOCATION:${icsEscape(location)}`);
  const details = [ev.description, ev.url].filter(Boolean).join('\n');
  if (details) lines.push(`DESCRIPTION:${icsEscape(details)}`);
  if (ev.url) lines.push(`URL:${icsEscape(ev.url)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
