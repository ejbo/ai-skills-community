import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { buildIcs } from '@/lib/events/calendar';
import { withBasePath } from '@/lib/base-path';

export const dynamic = 'force-dynamic';

// GET /api/events/[id]/ics — .ics download for "添加到日历". Public like the
// detail page; the member-only meeting link is deliberately NOT included.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const event = await prisma.event.findFirst({
    where: { id: params.id, deletedAt: null },
    select: {
      id: true,
      title: true,
      summary: true,
      startAt: true,
      endAt: true,
      allDay: true,
      venue: true,
      city: true,
      cancelledAt: true,
    },
  });
  if (!event) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Absolute detail URL from the proxied request (works at root and subpath).
  const proto = req.headers.get('x-forwarded-proto') ?? 'http';
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
  const url = host ? `${proto}://${host}${withBasePath(`/events/${event.id}`)}` : undefined;

  const ics = buildIcs({
    id: event.id,
    title: event.cancelledAt ? `【已取消】${event.title}` : event.title,
    startAt: event.startAt,
    endAt: event.endAt,
    allDay: event.allDay,
    venue: event.venue,
    city: event.city,
    description: event.summary || undefined,
    url,
  });

  return new NextResponse(ics, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      // ASCII-only filename — never a raw (CJK) title in a header.
      'content-disposition': `attachment; filename="event-${event.id}.ics"`,
      'cache-control': 'no-store',
    },
  });
}
