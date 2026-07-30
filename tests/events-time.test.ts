import { describe, expect, it } from 'vitest';
import {
  addDaysUtc,
  addMonthsUtc,
  dayKey,
  dayKeyToDate,
  eventDayKeysInWindow,
  eventLocalDayKey,
  fmtEventRange,
  fmtTime,
  monthGrid,
  monthKey,
  monthKeyToDate,
  parseWallTime,
  toWallDate,
  zonedWallToUtc,
} from '@/lib/events/time';
import { composeEventData, eventContentSchema } from '@/lib/events/validate';
import { eventLinkHref } from '@/lib/events/types';

describe('wall/date helpers', () => {
  it('parses date-only and date+time, rejects malformed input', () => {
    expect(parseWallTime('2026-08-05')?.toISOString()).toBe('2026-08-05T00:00:00.000Z');
    expect(parseWallTime('2026-08-05', '14:30')?.toISOString()).toBe('2026-08-05T14:30:00.000Z');
    expect(parseWallTime('2026-8-5')).toBeNull();
    expect(parseWallTime('2026-02-31')).toBeNull(); // no rollover to March
    expect(parseWallTime('2026-08-05', '24:00')).toBeNull();
    expect(parseWallTime('2026-08-05', '9:00')).toBeNull(); // requires HH:mm
  });

  it('round-trips day and month keys', () => {
    const d = parseWallTime('2026-08-05', '14:30')!;
    expect(dayKey(d)).toBe('2026-08-05');
    expect(dayKeyToDate('2026-08-05')!.toISOString()).toBe('2026-08-05T00:00:00.000Z');
    expect(monthKey(d)).toBe('2026-08');
    expect(monthKeyToDate('2026-08')!.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(monthKeyToDate('2026-13')).toBeNull();
  });

  it('formats human ranges for the four shapes', () => {
    const start = parseWallTime('2026-08-05', '14:00')!;
    expect(fmtEventRange(start, null, false)).toBe('2026年8月5日 周三 14:00');
    expect(fmtEventRange(start, parseWallTime('2026-08-05', '15:30'), false)).toBe(
      '2026年8月5日 周三 14:00 – 15:30',
    );
    expect(fmtEventRange(parseWallTime('2026-08-05')!, null, true)).toBe('2026年8月5日 周三 · 全天');
    expect(fmtEventRange(parseWallTime('2026-08-05')!, parseWallTime('2026-08-08'), true)).toBe(
      '2026年8月5日 – 8月8日',
    );
  });

  it('builds a Monday-first 42-cell month grid', () => {
    const cells = monthGrid(monthKeyToDate('2026-08')!); // Aug 2026 starts on a Saturday
    expect(cells).toHaveLength(42);
    expect(cells[0].key).toBe('2026-07-27'); // Monday before Aug 1
    expect(cells.filter((c) => c.inMonth)).toHaveLength(31);
    expect(monthKey(addMonthsUtc(monthKeyToDate('2026-12')!, 1))).toBe('2027-01');
  });

  it('expands day keys clamped to a window (months-long events light mid-span months)', () => {
    expect(eventDayKeysInWindow('2026-08-30', '2026-09-02', '2026-08-01', '2026-09-30')).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ]);
    // 101-day event viewed in a window far past its start: still lights the window.
    expect(eventDayKeysInWindow('2026-01-10', '2026-04-20', '2026-04-01', '2026-04-03')).toEqual([
      '2026-04-01',
      '2026-04-02',
      '2026-04-03',
    ]);
    expect(eventDayKeysInWindow('2026-05-01', '2026-05-02', '2026-06-01', '2026-06-30')).toEqual([]);
  });
});

describe('IANA zone conversion', () => {
  it('converts picked wall time + zone to the real UTC instant (DST-aware)', () => {
    // Toronto is EDT (UTC-4) in August, EST (UTC-5) in January.
    expect(zonedWallToUtc('2026-08-05', '14:00', 'America/Toronto')?.toISOString()).toBe(
      '2026-08-05T18:00:00.000Z',
    );
    expect(zonedWallToUtc('2026-01-05', '14:00', 'America/Toronto')?.toISOString()).toBe(
      '2026-01-05T19:00:00.000Z',
    );
    // Beijing has no DST (UTC+8).
    expect(zonedWallToUtc('2026-08-05', '14:00', 'Asia/Shanghai')?.toISOString()).toBe(
      '2026-08-05T06:00:00.000Z',
    );
    expect(zonedWallToUtc('2026-08-05', '14:00', 'Not/AZone')).toBeNull();
  });

  it('projects instants back into a zone wall clock (round trip)', () => {
    const instant = zonedWallToUtc('2026-08-05', '14:00', 'Asia/Shanghai')!;
    expect(fmtTime(toWallDate(instant, 'Asia/Shanghai'))).toBe('14:00');
    expect(dayKey(toWallDate(instant, 'Asia/Shanghai'))).toBe('2026-08-05');
    // The same instant is the evening BEFORE in Toronto.
    expect(dayKey(toWallDate(instant, 'America/Toronto'))).toBe('2026-08-05'); // 02:00 same day
    expect(fmtTime(toWallDate(instant, 'America/Toronto'))).toBe('02:00');
  });

  it('eventLocalDayKey groups by the event-own-zone date', () => {
    // 北京 8月6日 09:00 = Toronto 8月5日 21:00 — belongs to 8月6日.
    const instant = zonedWallToUtc('2026-08-06', '09:00', 'Asia/Shanghai')!;
    expect(eventLocalDayKey(instant, 'Asia/Shanghai', false)).toBe('2026-08-06');
    expect(eventLocalDayKey(parseWallTime('2026-08-06')!, null, true)).toBe('2026-08-06');
  });
});

describe('event content composition', () => {
  const base = {
    title: '多模态大模型前沿分享',
    kind: 'expert_talk',
    mode: 'online',
    startDate: '2026-08-05',
    startTime: '14:00',
    timezone: 'Asia/Shanghai',
  };

  function compose(input: Record<string, unknown>) {
    const parsed = eventContentSchema.safeParse({ ...base, ...input });
    if (!parsed.success) return { parseError: parsed.error.issues[0]?.message };
    return composeEventData(parsed.data);
  }

  it('composes a timed event in its picked zone', () => {
    const r = compose({ endTime: '15:30' });
    expect(r).toMatchObject({ ok: true });
    if ('value' in r && r.ok) {
      expect(r.value.columns.startAt.toISOString()).toBe('2026-08-05T06:00:00.000Z');
      expect(r.value.columns.endAt?.toISOString()).toBe('2026-08-05T07:30:00.000Z');
      expect(r.value.columns.timezone).toBe('Asia/Shanghai');
    }
  });

  it('rejects end before start, time-less non-allDay input, and bad zones', () => {
    expect(compose({ endTime: '13:00' })).toMatchObject({ ok: false });
    expect(compose({ startTime: '' })).toMatchObject({ ok: false });
    expect(compose({ timezone: 'Europe/Paris' })).toHaveProperty('parseError');
  });

  it('bounds the end year so a typo cannot park an event in 即将举行 forever', () => {
    expect(compose({ endDate: '9026-08-05', endTime: '15:00' })).toMatchObject({
      ok: false,
      reason: '结束日期超出可选范围',
    });
  });

  it('all-day events stay date-only with a null timezone', () => {
    const single = compose({ allDay: true, startTime: '', endDate: '2026-08-05' });
    if ('value' in single && single.ok) {
      expect(single.value.columns.startAt.toISOString()).toBe('2026-08-05T00:00:00.000Z');
      expect(single.value.columns.endAt).toBeNull();
      expect(single.value.columns.timezone).toBeNull();
    }
    const multi = compose({ allDay: true, startTime: '', endDate: '2026-08-08' });
    if ('value' in multi && multi.ok) {
      expect(multi.value.columns.endAt?.toISOString()).toBe('2026-08-08T00:00:00.000Z');
    }
  });

  it('sanitizes topics against the fixed taxonomy and caps at 3', () => {
    const r = compose({ topics: ['agents', 'nope', 'llm', 'graphics', 'algorithms'] });
    if ('value' in r && r.ok) expect(r.value.columns.topics).toEqual(['agents', 'llm', 'graphics']);
  });

  it('validates the fixed city options', () => {
    expect(compose({ city: 'Toronto' })).toMatchObject({ ok: true });
    expect(compose({ city: '多伦多' })).toHaveProperty('parseError');
  });

  it('accepts ANY link format at entry (no restriction) and orders speakers', () => {
    const r = compose({
      meetingUrl: 'welink://meeting/123',
      websiteUrl: 'www.neurips.cc',
      speakers: [{ name: '张三', link: 'w3.huawei.com/some/page' }, { name: 'Li Si', title: '研究员' }],
    });
    expect(r).toMatchObject({ ok: true });
    if ('value' in r && r.ok) {
      expect(r.value.columns.meetingUrl).toBe('welink://meeting/123');
      expect(r.value.columns.websiteUrl).toBe('www.neurips.cc');
      expect(r.value.speakers.map((s) => s.sortOrder)).toEqual([0, 1]);
    }
  });
});

describe('eventLinkHref (render-time link handling)', () => {
  it('passes real links through and prefixes scheme-less ones', () => {
    expect(eventLinkHref('https://neurips.cc')).toBe('https://neurips.cc');
    expect(eventLinkHref('welink://meeting/123')).toBe('welink://meeting/123');
    expect(eventLinkHref('www.neurips.cc')).toBe('http://www.neurips.cc');
    expect(eventLinkHref('w3.huawei.com/some/page')).toBe('http://w3.huawei.com/some/page');
  });

  it('neutralizes script pseudo-schemes and empties', () => {
    expect(eventLinkHref('javascript:alert(1)')).toBeNull();
    expect(eventLinkHref('JAVASCRIPT:alert(1)')).toBeNull();
    expect(eventLinkHref('data:text/html,x')).toBeNull();
    expect(eventLinkHref('')).toBeNull();
    expect(eventLinkHref(null)).toBeNull();
  });
});
