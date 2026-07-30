// 活动（Events）query layer. All reads go through here so the identity contract
// (AUTHOR_IDENTITY_SELECT → toPublicAuthor), the soft-delete filter and the
// timezone semantics are applied in exactly one place.
//
// Time model: timed events store REAL UTC instants + the organizer's IANA zone
// (fixed EVENT_TIMEZONES set); all-day events store date-only UTC midnights.
// Date filters are WALL DATES, resolved per zone: because the zone set is
// closed, every date condition compiles to exact SQL as an OR over per-zone
// instant windows (plus one all-day branch) — no approximations, no JS
// post-filtering. 即将举行 keeps an event until its last day ends IN ITS OWN
// ZONE. Legacy rows with timezone null count as the default zone.

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { AUTHOR_IDENTITY_SELECT, toPublicAuthor, type AuthorIdentity } from '@/lib/user-identity';
import {
  DEFAULT_EVENT_TIMEZONE,
  EVENT_TIMEZONES,
  type EventKindValue,
  type EventModeValue,
  type EventSpeakerData,
  type PublicEventItem,
} from '@/lib/events/types';
import {
  addDaysUtc,
  dayKey,
  dayKeyToDate,
  eventDayKeysInWindow,
  eventLocalDayKey,
  monthGrid,
  nowWall,
  startOfTodayInZone,
  toWallDate,
  zonedWallToUtc,
} from '@/lib/events/time';

export const EVENTS_PAGE_SIZE = 30;
export const MAX_PINNED_EVENTS = 3;

const TZ_VALUES = EVENT_TIMEZONES.map((t) => t.value);

export type EventTab = 'upcoming' | 'past';

export interface EventFilters {
  tab: EventTab;
  kind?: EventKindValue;
  topic?: string;
  mode?: EventModeValue;
  city?: string;
  q?: string;
  /** Explicit wall-clock date range (inclusive from, inclusive to — whole days). */
  from?: Date;
  to?: Date;
  /** Single-day filter from a calendar click; wins over from/to. */
  day?: Date;
}

interface Viewer {
  id: string | null;
  isAdmin: boolean;
}

// ── where builders ──────────────────────────────────────────────────────────

const BASE_WHERE: Prisma.EventWhereInput = { deletedAt: null };

/** Start of today in the wall-as-UTC space (for the all-day branch). */
function startOfTodayWall(): Date {
  return dayKeyToDate(dayKey(nowWall()))!;
}

/** timezone match for one zone; legacy null rows count as the default zone. */
function tzCond(zone: string): Prisma.EventWhereInput {
  return zone === DEFAULT_EVENT_TIMEZONE
    ? { OR: [{ timezone: zone }, { timezone: null }] }
    : { timezone: zone };
}

/** (endAt ?? startAt) >= boundary */
const effEndGte = (b: Date): Prisma.EventWhereInput => ({
  OR: [{ endAt: { gte: b } }, { endAt: null, startAt: { gte: b } }],
});

/** (endAt ?? startAt) < boundary */
const effEndLt = (b: Date): Prisma.EventWhereInput => ({
  OR: [{ endAt: { lt: b } }, { endAt: null, startAt: { lt: b } }],
});

/** Still running or in the future — per-zone "start of today" boundaries. */
function upcomingWhere(): Prisma.EventWhereInput {
  return {
    OR: [
      ...TZ_VALUES.map((z) => ({
        allDay: false,
        AND: [tzCond(z), effEndGte(startOfTodayInZone(z))],
      })),
      { allDay: true, ...effEndGte(startOfTodayWall()) },
    ],
  };
}

function pastWhere(): Prisma.EventWhereInput {
  return {
    OR: [
      ...TZ_VALUES.map((z) => ({
        allDay: false,
        AND: [tzCond(z), effEndLt(startOfTodayInZone(z))],
      })),
      { allDay: true, ...effEndLt(startOfTodayWall()) },
    ],
  };
}

/**
 * Events overlapping the wall-date range [from, toExclusive), resolved per
 * zone: a "day" spans different instants in each zone.
 */
function rangeWhere(from: Date, toExclusive: Date): Prisma.EventWhereInput {
  const fromKey = dayKey(from);
  const toExKey = dayKey(toExclusive);
  return {
    OR: [
      ...TZ_VALUES.map((z) => {
        const a = zonedWallToUtc(fromKey, '00:00', z) ?? from;
        const b = zonedWallToUtc(toExKey, '00:00', z) ?? toExclusive;
        return { allDay: false, AND: [tzCond(z), { startAt: { lt: b } }, effEndGte(a)] };
      }),
      { allDay: true, AND: [{ startAt: { lt: toExclusive } }, effEndGte(from)] },
    ],
  };
}

/**
 * Everything EXCEPT the date dimension — shared by the list, the facet counts
 * and the calendar (which swaps in its own month range).
 */
function facetWhere(f: Omit<EventFilters, 'tab' | 'from' | 'to' | 'day'>): Prisma.EventWhereInput {
  const and: Prisma.EventWhereInput[] = [BASE_WHERE];
  if (f.kind) and.push({ kind: f.kind });
  if (f.topic) and.push({ topics: { has: f.topic } });
  if (f.mode) and.push({ mode: f.mode });
  if (f.city) and.push({ city: f.city });
  const q = f.q?.trim();
  if (q) {
    and.push({
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { summary: { contains: q, mode: 'insensitive' } },
        { city: { contains: q, mode: 'insensitive' } },
        { speakers: { some: { name: { contains: q, mode: 'insensitive' } } } },
      ],
    });
  }
  return { AND: and };
}

/** The date dimension of the filters. */
function dateWhere(f: EventFilters): Prisma.EventWhereInput {
  if (f.day) return rangeWhere(f.day, addDaysUtc(f.day, 1));
  if (f.from || f.to) {
    const from = f.from ?? new Date(Date.UTC(1970, 0, 1));
    const toExclusive = f.to ? addDaysUtc(f.to, 1) : new Date(Date.UTC(2101, 0, 1));
    return rangeWhere(from, toExclusive);
  }
  return f.tab === 'past' ? pastWhere() : upcomingWhere();
}

function listWhere(f: EventFilters): Prisma.EventWhereInput {
  return { AND: [facetWhere(f), dateWhere(f)] };
}

// ── row → public mapping ────────────────────────────────────────────────────

const EVENT_INCLUDE = {
  author: AUTHOR_IDENTITY_SELECT,
  speakers: { orderBy: { sortOrder: 'asc' as const } },
} satisfies Prisma.EventInclude;

type EventRow = Prisma.EventGetPayload<{ include: typeof EVENT_INCLUDE }>;

function toSpeakerData(s: EventRow['speakers'][number]): EventSpeakerData {
  return { name: s.name, title: s.title, org: s.org, avatarUrl: s.avatarUrl, link: s.link, bio: s.bio };
}

export function toPublicEvent(row: EventRow, viewer: Viewer): PublicEventItem {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    kind: row.kind as EventKindValue,
    topics: row.topics,
    mode: row.mode as EventModeValue,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt ? row.endAt.toISOString() : null,
    allDay: row.allDay,
    timezone: row.allDay ? null : (row.timezone ?? DEFAULT_EVENT_TIMEZONE),
    venue: row.venue,
    city: row.city,
    // Server-side trim: the join link is member-only (the external deploy is
    // world-readable) — never shipped-then-hidden.
    meetingUrl: viewer.id ? row.meetingUrl : null,
    websiteUrl: row.websiteUrl,
    coverUrl: row.coverUrl,
    pinned: row.pinned,
    cancelled: row.cancelledAt != null,
    speakers: row.speakers.map(toSpeakerData),
    author: toPublicAuthor(row.author as AuthorIdentity, viewer.isAdmin),
    isOwner: viewer.isAdmin || (viewer.id != null && viewer.id === row.authorId),
    isAuthor: viewer.id != null && viewer.id === row.authorId,
  };
}

export interface PublicEventDetail extends PublicEventItem {
  descriptionMd: string;
  createdAt: string;
}

// ── reads ───────────────────────────────────────────────────────────────────

export interface EventListResult {
  items: PublicEventItem[];
  total: number;
  page: number;
  pageCount: number;
}

export async function listEvents(
  filters: EventFilters,
  viewer: Viewer,
  page = 1,
): Promise<EventListResult> {
  const where = listWhere(filters);
  // Past tab reads most-recent-first; every dated view reads soonest-first.
  const explicitRange = Boolean(filters.day || filters.from || filters.to);
  const asc = explicitRange || filters.tab !== 'past';
  // Count first so an out-of-range ?page clamps into [1, pageCount] instead of
  // rendering a false "没有匹配" empty state.
  const total = await prisma.event.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / EVENTS_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const rows = await prisma.event.findMany({
    where,
    include: EVENT_INCLUDE,
    orderBy: [{ startAt: asc ? 'asc' : 'desc' }, { id: 'asc' }],
    skip: (safePage - 1) * EVENTS_PAGE_SIZE,
    take: EVENTS_PAGE_SIZE,
  });
  // Group-stable ordering: sort the page by (event-local date, instant) so a
  // 北京 morning event doesn't interleave a Toronto date group in UTC order.
  rows.sort((a, b) => {
    const ka = eventLocalDayKey(a.startAt, a.timezone, a.allDay);
    const kb = eventLocalDayKey(b.startAt, b.timezone, b.allDay);
    if (ka !== kb) return (ka < kb ? -1 : 1) * (asc ? 1 : -1);
    const d = a.startAt.getTime() - b.startAt.getTime();
    return asc ? d : -d;
  });
  return {
    items: rows.map((r) => toPublicEvent(r, viewer)),
    total,
    page: safePage,
    pageCount,
  };
}

/** 推荐位: admin-pinned, not cancelled, not over. */
export async function listPinnedUpcoming(viewer: Viewer): Promise<PublicEventItem[]> {
  const rows = await prisma.event.findMany({
    where: { ...BASE_WHERE, pinned: true, cancelledAt: null, AND: [upcomingWhere()] },
    include: EVENT_INCLUDE,
    orderBy: { startAt: 'asc' },
    take: MAX_PINNED_EVENTS,
  });
  return rows.map((r) => toPublicEvent(r, viewer));
}

export async function getEventDetail(id: string, viewer: Viewer): Promise<PublicEventDetail | null> {
  const row = await prisma.event.findFirst({
    where: { id, deletedAt: null },
    include: EVENT_INCLUDE,
  });
  if (!row) return null;
  return {
    ...toPublicEvent(row, viewer),
    descriptionMd: row.descriptionMd,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Sidebar 大类 counts, respecting every OTHER active filter (incl. the date tab). */
export async function countEventsByKind(filters: EventFilters): Promise<Record<string, number>> {
  const { kind: _drop, ...rest } = filters;
  const grouped = await prisma.event.groupBy({
    by: ['kind'],
    where: { AND: [facetWhere(rest), dateWhere(rest as EventFilters)] },
    _count: { _all: true },
  });
  return Object.fromEntries(grouped.map((g) => [g.kind, g._count._all]));
}

/** 城市 counts for the fixed EVENT_CITIES rail, respecting every OTHER filter. */
export async function countEventsByCity(filters: EventFilters): Promise<Record<string, number>> {
  const { city: _drop, ...rest } = filters;
  const grouped = await prisma.event.groupBy({
    by: ['city'],
    where: { AND: [facetWhere(rest), dateWhere(rest as EventFilters), { city: { not: null } }] },
    _count: { _all: true },
  });
  return Object.fromEntries(
    grouped.filter((g) => g.city).map((g) => [g.city as string, g._count._all]),
  );
}

// ── mini calendar ───────────────────────────────────────────────────────────

export interface CalendarAgendaItem {
  id: string;
  title: string;
  startAt: string;
  allDay: boolean;
  timezone: string | null;
  /** Event-local date the event STARTS on — later days render 续, not a time. */
  startDayKey: string;
  kind: EventKindValue;
  cancelled: boolean;
}

export interface CalendarMonthData {
  /** dayKey → number of events touching that day (filters applied, day filter excluded). */
  counts: Record<string, number>;
  /** dayKey → compact items for the agenda list, in-month days only, chronological. */
  agenda: { key: string; items: CalendarAgendaItem[] }[];
}

/**
 * One query powers both the dot grid and the per-day agenda under it. Multi-day
 * events light every day they touch (day expansion clamped to the grid window,
 * so a months-long conference still lights mid-span months). Respects the facet
 * filters so 日历随筛选联动, but ignores day/from/to/tab (the calendar IS the
 * date picker).
 */
export async function getCalendarMonth(
  month: Date,
  filters: EventFilters,
): Promise<CalendarMonthData> {
  const cells = monthGrid(month);
  const gridStartKey = cells[0].key;
  const gridEndKey = cells[cells.length - 1].key;
  const gridStart = dayKeyToDate(gridStartKey)!;
  const gridEndExclusive = addDaysUtc(dayKeyToDate(gridEndKey)!, 1);
  const rows = await prisma.event.findMany({
    where: {
      AND: [
        facetWhere({ kind: filters.kind, topic: filters.topic, mode: filters.mode, city: filters.city, q: filters.q }),
        rangeWhere(gridStart, gridEndExclusive),
      ],
    },
    select: {
      id: true,
      title: true,
      startAt: true,
      endAt: true,
      allDay: true,
      timezone: true,
      kind: true,
      cancelledAt: true,
    },
    orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
    take: 400,
  });

  const counts: Record<string, number> = {};
  const byDay = new Map<string, CalendarAgendaItem[]>();
  const inMonth = new Set(cells.filter((c) => c.inMonth).map((c) => c.key));
  for (const row of rows) {
    const zone = row.allDay ? null : (row.timezone ?? DEFAULT_EVENT_TIMEZONE);
    const startKey = eventLocalDayKey(row.startAt, row.timezone, row.allDay);
    const endKey =
      row.endAt && row.endAt.getTime() >= row.startAt.getTime()
        ? zone
          ? dayKey(toWallDate(row.endAt, zone))
          : dayKey(row.endAt)
        : startKey;
    const item: CalendarAgendaItem = {
      id: row.id,
      title: row.title,
      startAt: row.startAt.toISOString(),
      allDay: row.allDay,
      timezone: zone,
      startDayKey: startKey,
      kind: row.kind as EventKindValue,
      cancelled: row.cancelledAt != null,
    };
    for (const key of eventDayKeysInWindow(startKey, endKey, gridStartKey, gridEndKey)) {
      counts[key] = (counts[key] ?? 0) + 1;
      if (inMonth.has(key)) {
        const list = byDay.get(key) ?? [];
        list.push(item);
        byDay.set(key, list);
      }
    }
  }
  const agenda = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, items]) => ({ key, items }));
  return { counts, agenda };
}
