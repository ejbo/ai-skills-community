// Shared zod schema + time composition for the event create (POST) and
// content-edit (PATCH) routes — one source of truth so the two can't drift.
// zod messages are user-facing Chinese strings (shown verbatim in toasts).

import { z } from 'zod';
import {
  DEFAULT_EVENT_TIMEZONE,
  EVENT_CITIES,
  MAX_EVENT_SPEAKERS,
  MAX_EVENT_TOPICS,
  cleanTopics,
  type EventSpeakerData,
  type EventTimezoneValue,
} from '@/lib/events/types';
import { parseWallTime, zonedWallToUtc } from '@/lib/events/time';

/**
 * Free-form link — deliberately NO format restriction (welink://, 内网地址,
 * scheme-less www.x.com, anything goes; only a length cap). Script-scheme
 * neutralization happens at RENDER time via eventLinkHref(), never at entry.
 */
const linkOrEmpty = (label: string) => z.string().trim().max(500, `${label}过长`).default('');

/** '' | https?:// | a stored root-relative upload URL. */
const imageUrlOrEmpty = (label: string) =>
  z
    .string()
    .trim()
    .max(500, `${label}过长`)
    .refine(
      (v) => v === '' || /^https?:\/\//i.test(v) || v.startsWith('/api/uploads/'),
      `${label}无效`,
    )
    .default('');

const speakerSchema = z.object({
  name: z.string().trim().min(1, '讲师姓名不能为空').max(80, '讲师姓名过长'),
  title: z.string().trim().max(120, '讲师头衔过长').default(''),
  org: z.string().trim().max(120, '讲师单位过长').default(''),
  avatarUrl: imageUrlOrEmpty('讲师头像'),
  link: linkOrEmpty('讲师主页链接'),
  bio: z.string().trim().max(2000, '讲师介绍过长').default(''),
});

export const eventContentSchema = z.object({
  title: z.string().trim().min(4, '标题至少 4 个字').max(140, '标题最多 140 字'),
  summary: z.string().trim().max(300, '一句话简介最多 300 字').default(''),
  descriptionMd: z.string().max(20000, '活动介绍过长').default(''),
  kind: z.enum(['external', 'internal', 'expert_talk', 'seminar'], {
    errorMap: () => ({ message: '请选择活动大类' }),
  }),
  topics: z.array(z.string()).max(24).default([]),
  mode: z.enum(['online', 'offline', 'hybrid'], {
    errorMap: () => ({ message: '请选择活动形式' }),
  }),
  startDate: z.string().trim().min(1, '请选择开始日期'),
  startTime: z.string().trim().default(''),
  endDate: z.string().trim().default(''),
  endTime: z.string().trim().default(''),
  allDay: z.boolean().default(false),
  // 固定四选一（IANA 入库）；全天活动忽略。
  timezone: z
    .enum(['America/Toronto', 'America/Edmonton', 'America/Vancouver', 'Asia/Shanghai'], {
      errorMap: () => ({ message: '请选择活动时区' }),
    })
    .default(DEFAULT_EVENT_TIMEZONE),
  venue: z.string().trim().max(200, '地点过长').default(''),
  // 固定城市选项（可不填）。
  city: z
    .string()
    .trim()
    .refine((v) => v === '' || (EVENT_CITIES as readonly string[]).includes(v), '城市选项无效')
    .default(''),
  meetingUrl: linkOrEmpty('会议链接'),
  websiteUrl: linkOrEmpty('官网/报名链接'),
  coverUrl: imageUrlOrEmpty('封面图'),
  // '' = 未选裁切（详情页完整显示）；否则 CSS object-position，如 '50% 30%'。
  coverPos: z
    .string()
    .trim()
    .refine((v) => v === '' || /^(100|\d{1,2})% (100|\d{1,2})%$/.test(v), '封面裁切位置无效')
    .default(''),
  speakers: z.array(speakerSchema).max(MAX_EVENT_SPEAKERS, `讲师最多 ${MAX_EVENT_SPEAKERS} 位`).default([]),
});

export type EventContentInput = z.infer<typeof eventContentSchema>;

export interface ComposedEvent {
  columns: {
    title: string;
    summary: string;
    descriptionMd: string;
    kind: EventContentInput['kind'];
    topics: string[];
    mode: EventContentInput['mode'];
    startAt: Date;
    endAt: Date | null;
    allDay: boolean;
    timezone: EventTimezoneValue | null;
    venue: string | null;
    city: string | null;
    meetingUrl: string | null;
    websiteUrl: string | null;
    coverUrl: string | null;
    coverPos: string | null;
  };
  speakers: (EventSpeakerData & { sortOrder: number })[];
}

const orNull = (v: string) => (v === '' ? null : v);

/**
 * Turn validated input into DB columns, or a user-facing Chinese error.
 * Timed events: picked wall time + picked zone → real UTC instant.
 * All-day events: date-only, stored as UTC midnight, timezone null.
 */
export function composeEventData(
  input: EventContentInput,
): { ok: true; value: ComposedEvent } | { ok: false; reason: string } {
  const zone = input.timezone;
  const startAt = input.allDay
    ? parseWallTime(input.startDate)
    : input.startTime
      ? zonedWallToUtc(input.startDate, input.startTime, zone)
      : null;
  if (!startAt) {
    return { ok: false, reason: input.allDay ? '开始日期无效' : '请填写有效的开始日期和时间' };
  }
  const year = startAt.getUTCFullYear();
  if (year < 2000 || year > 2100) return { ok: false, reason: '开始日期超出可选范围' };

  let endAt: Date | null = null;
  if (input.allDay) {
    if (input.endDate) {
      endAt = parseWallTime(input.endDate);
      if (!endAt) return { ok: false, reason: '结束日期无效' };
      if (endAt.getTime() < startAt.getTime()) return { ok: false, reason: '结束日期不能早于开始日期' };
      if (endAt.getTime() === startAt.getTime()) endAt = null; // 单日全天
    }
  } else if (input.endTime) {
    endAt = zonedWallToUtc(input.endDate || input.startDate, input.endTime, zone);
    if (!endAt) return { ok: false, reason: '结束时间无效' };
    if (endAt.getTime() <= startAt.getTime()) return { ok: false, reason: '结束时间需晚于开始时间' };
  } else if (input.endDate && input.endDate !== input.startDate) {
    return { ok: false, reason: '请填写结束时间（或勾选「全天」）' };
  }
  // startAt is bounded above, so only the upper end can run away on a typo'd
  // end year — and an absurd endAt parks the event in 即将举行 forever.
  if (endAt && endAt.getUTCFullYear() > 2100) {
    return { ok: false, reason: '结束日期超出可选范围' };
  }

  return {
    ok: true,
    value: {
      columns: {
        title: input.title,
        summary: input.summary,
        descriptionMd: input.descriptionMd,
        kind: input.kind,
        topics: cleanTopics(input.topics).slice(0, MAX_EVENT_TOPICS),
        mode: input.mode,
        startAt,
        endAt,
        allDay: input.allDay,
        timezone: input.allDay ? null : zone,
        venue: orNull(input.venue),
        city: orNull(input.city),
        meetingUrl: orNull(input.meetingUrl),
        websiteUrl: orNull(input.websiteUrl),
        coverUrl: orNull(input.coverUrl),
        // Crop without an image is meaningless — never store a dangling position.
        coverPos: input.coverUrl ? orNull(input.coverPos) : null,
      },
      speakers: input.speakers.map((s, i) => ({
        name: s.name,
        title: s.title,
        org: s.org,
        avatarUrl: s.avatarUrl,
        link: s.link,
        bio: s.bio,
        sortOrder: i,
      })),
    },
  };
}
