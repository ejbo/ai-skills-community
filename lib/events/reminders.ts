// 活动开始前提醒 sweep. Finds timed, live events starting within the next
// ~REMINDER_WINDOW and notifies every attendee who hasn't been reminded yet
// (in-app + best-effort email via lib/notifications.ts). Rows are claimed
// ATOMICALLY (updateMany remindedAt: null → now), so concurrent sweeps — the
// throttled notifications-poll hook on several processes, plus the cron
// script — can never double-send.
//
// Trigger paths:
//  1. sweepEventRemindersThrottled() piggybacks on GET /api/notifications
//     (the bell polls it constantly while anyone is online) — zero ops setup.
//  2. scripts/send-event-reminders.ts for a real cron (belt and braces, e.g.
//     `*/5 * * * *` on the deploy box; delivers even when nobody is browsing).

import { prisma } from '@/lib/db';
import { notifyEventReminder } from '@/lib/notifications';
import { fmtTime, toWallDate } from '@/lib/events/time';
import { DEFAULT_EVENT_TIMEZONE, TZ_SHORT } from '@/lib/events/types';

/** 提前量：开始前 ~30 分钟提醒（窗口略宽，容忍轮询间隔）。 */
const REMINDER_WINDOW_MS = 35 * 60 * 1000;
const SWEEP_THROTTLE_MS = 60 * 1000;

let lastSweepAt = 0;

/** Fire-and-forget, at most once a minute per process; never throws. */
export function sweepEventRemindersThrottled(): void {
  const now = Date.now();
  if (now - lastSweepAt < SWEEP_THROTTLE_MS) return;
  lastSweepAt = now;
  void sweepEventReminders().catch((e) => console.error('[events] reminder sweep failed:', e));
}

/** @returns how many reminders were sent (for the cron script's log line). */
export async function sweepEventReminders(): Promise<number> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_MS);
  // All-day events are date-only (no meaningful "30 minutes before"); skip.
  const events = await prisma.event.findMany({
    where: {
      deletedAt: null,
      cancelledAt: null,
      allDay: false,
      startAt: { gt: now, lte: windowEnd },
      attendees: { some: { remindedAt: null } },
    },
    select: {
      id: true,
      title: true,
      startAt: true,
      timezone: true,
      mode: true,
      venue: true,
      city: true,
      meetingUrl: true,
      attendees: {
        where: { remindedAt: null },
        select: { userId: true, user: { select: { email: true } } },
      },
    },
    take: 50,
  });

  let sent = 0;
  for (const ev of events) {
    const zone = ev.timezone ?? DEFAULT_EVENT_TIMEZONE;
    const timeLabel = `${fmtTime(toWallDate(ev.startAt, zone))}（${TZ_SHORT[zone] ?? ''}时间）`;
    const location =
      ev.mode === 'online' ? '线上' : [ev.venue, ev.city].filter(Boolean).join(' · ') || '线下';
    const minutesLeft = Math.max(1, Math.round((ev.startAt.getTime() - Date.now()) / 60_000));
    for (const a of ev.attendees) {
      // Atomic claim — 0 rows means another process got here first.
      const claimed = await prisma.eventAttendee.updateMany({
        where: { eventId: ev.id, userId: a.userId, remindedAt: null },
        data: { remindedAt: new Date() },
      });
      if (claimed.count === 0) continue;
      await notifyEventReminder({
        recipientId: a.userId,
        recipientEmail: a.user.email,
        eventId: ev.id,
        eventTitle: ev.title,
        minutesLeft,
        timeLabel,
        location,
        meetingUrl: ev.meetingUrl,
      });
      sent++;
    }
  }
  return sent;
}
