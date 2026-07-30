// 活动时间工具。Two time domains live here:
//
// 1. TIMED events: Event.startAt/endAt are REAL UTC instants, computed from the
//    organizer's picked wall time + picked IANA zone (EVENT_TIMEZONES) via
//    zonedWallToUtc(). To render in ANY zone, first project the instant into
//    that zone's wall clock with toWallDate(instant, zone) — the result encodes
//    the wall time as UTC, so every formatter below (all UTC-getter based)
//    works on it unchanged. Viewer-local display = toWallDate with the
//    browser's zone (client side).
// 2. ALL-DAY events: date-only, stored as UTC midnight; never zone-converted.
//    Handled directly by the wall helpers (parseWallTime/dayKey/...).
//
// nowWall() reads the CURRENT wall clock via local getters and re-encodes it in
// the wall-as-UTC space — used for date presets and 今天/明天 labels.
// Client-safe: no server-only imports.

import { DEFAULT_EVENT_TIMEZONE } from '@/lib/events/types';

const DAY_MS = 86_400_000;

/** 'YYYY-MM-DD' (+ optional 'HH:mm') → wall-clock Date, or null if malformed. */
export function parseWallTime(date: string, time?: string | null): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  if (!dm) return null;
  let h = 0;
  let min = 0;
  if (time) {
    const tm = /^(\d{2}):(\d{2})$/.exec(time);
    if (!tm) return null;
    h = Number(tm[1]);
    min = Number(tm[2]);
    if (h > 23 || min > 59) return null;
  }
  const d = new Date(Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), h, min));
  // Reject rollovers like 2026-02-31.
  if (d.getUTCFullYear() !== Number(dm[1]) || d.getUTCMonth() !== Number(dm[2]) - 1 || d.getUTCDate() !== Number(dm[3])) {
    return null;
  }
  return d;
}

/** Current wall clock re-encoded into the wall-as-UTC space. */
export function nowWall(): Date {
  const n = new Date();
  return new Date(
    Date.UTC(n.getFullYear(), n.getMonth(), n.getDate(), n.getHours(), n.getMinutes(), n.getSeconds()),
  );
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' key from a wall-clock Date (UTC parts). */
export function dayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** 'YYYY-MM-DD' → wall-clock midnight Date, or null. */
export function dayKeyToDate(key: string): Date | null {
  return parseWallTime(key);
}

/** 'YYYY-MM' key (calendar month param). */
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

/** 'YYYY-MM' → first-of-month wall Date, or null. */
export function monthKeyToDate(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key ?? '');
  if (!m) return null;
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) return null;
  return new Date(Date.UTC(Number(m[1]), mon - 1, 1));
}

export function addDaysUtc(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

export function addMonthsUtc(d: Date, months: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
}

export function startOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Exclusive end: first day of the NEXT month. */
export function endOfMonthUtcExclusive(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

const WEEKDAY_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function weekdayZh(d: Date): string {
  return WEEKDAY_ZH[d.getUTCDay()];
}

/** '8月5日' */
export function fmtDateShort(d: Date): string {
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

/** '2026年8月5日' */
export function fmtDateFull(d: Date): string {
  return `${d.getUTCFullYear()}年${fmtDateShort(d)}`;
}

/** '14:00' */
export function fmtTime(d: Date): string {
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

// ── Locale-aware variants of the three formatters above ────────────────────
// The zh helpers stay: `fmtEventRange`/`humanRange` build composite strings from
// them and tests pin their exact output. New UI takes these instead, passing the
// next-intl locale. `timeZone: 'UTC'` is REQUIRED — these Dates are UTC-midnight
// *wall* dates (dayKeyToDate/nowWall), so formatting them in the server's local
// zone would slide the rendered day by one.

/** '8月5日' / 'Aug 5' / '5 août' */
export function fmtDateShortL(d: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
}

/** '2026年8月5日' / 'Aug 5, 2026' / '5 août 2026' */
export function fmtDateFullL(d: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

/** '周三' / 'Wed' / 'mer.' */
export function weekdayShortL(d: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(d);
}

export function sameUtcDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

/**
 * Human range for a card / detail header. Examples:
 *   全天单日:  2026年8月5日 周三 · 全天
 *   全天多日:  2026年8月5日 – 8月8日
 *   定时单日:  2026年8月5日 周三 14:00 – 15:30
 *   定时跨日:  2026年8月5日 14:00 – 8月6日 12:00
 */
export function fmtEventRange(startAt: Date, endAt: Date | null, allDay: boolean): string {
  if (allDay) {
    if (endAt && !sameUtcDay(startAt, endAt)) {
      const sameYear = startAt.getUTCFullYear() === endAt.getUTCFullYear();
      return `${fmtDateFull(startAt)} – ${sameYear ? fmtDateShort(endAt) : fmtDateFull(endAt)}`;
    }
    return `${fmtDateFull(startAt)} ${weekdayZh(startAt)} · 全天`;
  }
  if (endAt) {
    if (sameUtcDay(startAt, endAt)) {
      return `${fmtDateFull(startAt)} ${weekdayZh(startAt)} ${fmtTime(startAt)} – ${fmtTime(endAt)}`;
    }
    return `${fmtDateFull(startAt)} ${fmtTime(startAt)} – ${fmtDateShort(endAt)} ${fmtTime(endAt)}`;
  }
  return `${fmtDateFull(startAt)} ${weekdayZh(startAt)} ${fmtTime(startAt)}`;
}

/** Compact time cell for the day-grouped list: '14:00' / '全天' / '进行中' handled by caller. */
export function fmtStartTime(startAt: Date, allDay: boolean): string {
  return allDay ? '全天' : fmtTime(startAt);
}

/**
 * Every dayKey an event touches within [windowStart, windowEnd] (wall dates,
 * inclusive; pass the grid bounds so a months-long conference still lights the
 * current month — enumerating from the event's own start would blow the cap).
 */
export function eventDayKeysInWindow(
  startKey: string,
  endKey: string,
  windowStartKey: string,
  windowEndKey: string,
): string[] {
  const from = startKey > windowStartKey ? startKey : windowStartKey;
  const to = endKey < windowEndKey ? endKey : windowEndKey;
  const keys: string[] = [];
  let cur = dayKeyToDate(from);
  const last = dayKeyToDate(to);
  if (!cur || !last) return keys;
  while (cur.getTime() <= last.getTime() && keys.length < 62) {
    keys.push(dayKey(cur));
    cur = addDaysUtc(cur, 1);
  }
  return keys;
}

// ── IANA-zone conversion (Intl-based; full ICU ships with Node 20 + browsers) ─

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function dtf(zone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    dtfCache.set(zone, f);
  }
  return f;
}

/** The instant's wall-clock in `zone`, as epoch millis in the wall-as-UTC space. */
function wallMillisInZone(instant: Date, zone: string): number {
  const p: Record<string, number> = {};
  for (const part of dtf(zone).formatToParts(instant)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second);
}

/**
 * Project a real UTC instant into `zone`'s wall clock, encoded as UTC — the
 * bridge to every UTC-getter formatter in this file (fmtTime/dayKey/…).
 * An unknown zone (corrupt data / exotic browser) falls back to UTC.
 */
export function toWallDate(instant: Date, zone: string): Date {
  try {
    return new Date(wallMillisInZone(instant, zone));
  } catch {
    return instant;
  }
}

/**
 * 'YYYY-MM-DD' + 'HH:mm' entered in `zone` → the real UTC instant (DST-aware,
 * two-pass offset resolution). Null on malformed input or unknown zone.
 */
export function zonedWallToUtc(date: string, time: string, zone: string): Date | null {
  const wall = parseWallTime(date, time);
  if (!wall) return null;
  try {
    const guess = wall.getTime();
    let utc = guess - (wallMillisInZone(new Date(guess), zone) - guess);
    utc = guess - (wallMillisInZone(new Date(utc), zone) - utc);
    return new Date(utc);
  } catch {
    return null;
  }
}

/** The real instant at which `zone`'s current day started (local midnight). */
export function startOfTodayInZone(zone: string): Date {
  const todayKey = dayKey(toWallDate(new Date(), zone));
  return zonedWallToUtc(todayKey, '00:00', zone) ?? new Date();
}

/**
 * The calendar date an event belongs to: its start date in its OWN zone for
 * timed events, the stored date for all-day ones. Drives list grouping and
 * calendar dots (accepts Date or ISO so both server rows and client payloads
 * can use it).
 */
export function eventLocalDayKey(
  startAt: Date | string,
  timezone: string | null,
  allDay: boolean,
): string {
  const d = typeof startAt === 'string' ? new Date(startAt) : startAt;
  if (allDay) return dayKey(d);
  // Legacy timed rows without a zone count as the default zone, matching the
  // query layer's tzCond().
  return dayKey(toWallDate(d, timezone ?? DEFAULT_EVENT_TIMEZONE));
}

export interface CalendarCell {
  key: string; // 'YYYY-MM-DD'
  day: number; // 1..31
  inMonth: boolean;
}

/**
 * 6-week Monday-first month grid (42 cells) around the given month, for the
 * mini calendar. Leading/trailing cells come from adjacent months.
 */
export function monthGrid(month: Date): CalendarCell[] {
  const first = startOfMonthUtc(month);
  const lead = (first.getUTCDay() + 6) % 7; // days since Monday
  const gridStart = addDaysUtc(first, -lead);
  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = addDaysUtc(gridStart, i);
    cells.push({ key: dayKey(d), day: d.getUTCDate(), inMonth: d.getUTCMonth() === month.getUTCMonth() });
  }
  return cells;
}
