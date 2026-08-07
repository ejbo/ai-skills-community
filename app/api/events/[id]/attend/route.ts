import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// POST /api/events/[id]/attend — toggle 我要参加. Joining doubles as the opt-in
// for the pre-start reminder (lib/events/reminders.ts). Guarded array
// transactions keep attendeeCount honest; same-user races fall through to the
// authoritative re-read (like-route pattern), never 500.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const userId = session.user.id;

  const event = await prisma.event.findFirst({
    where: { id: params.id, deletedAt: null },
    select: { id: true, cancelledAt: true, startAt: true, endAt: true, allDay: true },
  });
  if (!event) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const key = { userId_eventId: { userId, eventId: event.id } };
  const existing = await prisma.eventAttendee.findUnique({ where: key });

  if (!existing) {
    // Join-side gates only — leaving a cancelled/finished event always works.
    if (event.cancelledAt) {
      return NextResponse.json(
        { error: 'invalid_input', reason: '活动已取消，无法添加' },
        { status: 400 },
      );
    }
    // Over = past the end of its last day (all-day rows are date-only, so the
    // event runs through end-of-date; timed rows end at the stored instant).
    const effEnd = event.endAt ?? event.startAt;
    const overAt = event.allDay ? effEnd.getTime() + 24 * 60 * 60 * 1000 : effEnd.getTime();
    if (overAt < Date.now()) {
      return NextResponse.json(
        { error: 'invalid_input', reason: '活动已结束，无法添加' },
        { status: 400 },
      );
    }
  }

  try {
    if (existing) {
      await prisma.$transaction([
        prisma.eventAttendee.delete({ where: key }),
        prisma.event.update({
          where: { id: event.id },
          data: { attendeeCount: { decrement: 1 } },
        }),
      ]);
    } else {
      await prisma.$transaction([
        prisma.eventAttendee.create({ data: { userId, eventId: event.id } }),
        prisma.event.update({
          where: { id: event.id },
          data: { attendeeCount: { increment: 1 } },
        }),
      ]);
    }
  } catch {
    // Second-tab race: the failed array transaction rolled its counter update
    // back — fall through and report whatever state won.
  }

  const [row, ev] = await Promise.all([
    prisma.eventAttendee.findUnique({ where: key, select: { userId: true } }),
    prisma.event.findUnique({ where: { id: event.id }, select: { attendeeCount: true } }),
  ]);

  return NextResponse.json({
    ok: true,
    attending: Boolean(row),
    attendeeCount: Math.max(0, ev?.attendeeCount ?? 0),
  });
}
