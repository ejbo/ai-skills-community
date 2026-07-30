// 活动（Events）shared taxonomy + types. Client-safe: no server-only imports.
//
// 大类 = EventKind (Prisma enum, one per event) — what KIND of gathering it is.
// 小类 = topics (string slugs, multi-select ≤3) — what it is ABOUT. The two are
// orthogonal facets, mirroring how Eventbrite separates "format" from
// "category" and how LIBRARY_CATEGORIES works (fixed taxonomy, not free tags).

import type { PublicAuthor } from '@/lib/user-identity';

export const EVENT_KINDS = [
  { value: 'external', label: '外部活动', desc: '学术会议 / 行业峰会 / 外部讲座' },
  { value: 'internal', label: '内部活动', desc: '团队 / 公司内部活动' },
  { value: 'expert_talk', label: '专家分享', desc: '特邀专家讲座 / 访谈' },
  { value: 'seminar', label: '研讨会', desc: '主题研讨 / Workshop / 读书会' },
] as const;

export type EventKindValue = (typeof EVENT_KINDS)[number]['value'];

export const KIND_LABEL: Record<string, string> = Object.fromEntries(
  EVENT_KINDS.map((k) => [k.value, k.label]),
);

export function isEventKind(v: unknown): v is EventKindValue {
  return typeof v === 'string' && v in KIND_LABEL;
}

export const EVENT_TOPICS = [
  { slug: 'agents', name: 'Agent 与工具' },
  { slug: 'llm', name: '大模型' },
  { slug: 'multimodal', name: '多模态' },
  { slug: 'graphics', name: '图形图像' },
  { slug: 'algorithms', name: '算法' },
  { slug: 'embodied', name: '具身智能' },
  { slug: 'infra', name: '算力与系统' },
  { slug: 'data', name: '数据工程' },
  { slug: 'research', name: '前沿研究' },
  { slug: 'other', name: '其他' },
] as const;

export type EventTopicSlug = (typeof EVENT_TOPICS)[number]['slug'];

export const TOPIC_NAME_BY_SLUG: Record<string, string> = Object.fromEntries(
  EVENT_TOPICS.map((t) => [t.slug, t.name]),
);

export function isEventTopic(v: unknown): v is EventTopicSlug {
  return typeof v === 'string' && v in TOPIC_NAME_BY_SLUG;
}

export const MAX_EVENT_TOPICS = 3;

/** Sanitize a client-supplied topics value: known slugs, deduped, max 3. */
export function cleanTopics(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter(isEventTopic))].slice(0, MAX_EVENT_TOPICS);
}

// 固定时区选项（IANA zone 入库）。定时活动必选其一；组织者按该时区填时间，
// startAt/endAt 存换算后的真实 UTC 时刻，前端再换算成查看者本地时间显示。
export const EVENT_TIMEZONES = [
  { value: 'America/Toronto', label: '东部时间（多伦多）', short: '东部' },
  { value: 'America/Edmonton', label: '中部时间（埃德蒙顿）', short: '中部' },
  { value: 'America/Vancouver', label: '西部时间（温哥华）', short: '西部' },
  { value: 'Asia/Shanghai', label: '北京时间', short: '北京' },
] as const;

export type EventTimezoneValue = (typeof EVENT_TIMEZONES)[number]['value'];

export const DEFAULT_EVENT_TIMEZONE: EventTimezoneValue = 'America/Toronto';

export const TZ_LABEL: Record<string, string> = Object.fromEntries(
  EVENT_TIMEZONES.map((t) => [t.value, t.label]),
);

export const TZ_SHORT: Record<string, string> = Object.fromEntries(
  EVENT_TIMEZONES.map((t) => [t.value, t.short]),
);

export function isEventTimezone(v: unknown): v is EventTimezoneValue {
  return typeof v === 'string' && v in TZ_LABEL;
}

// 固定城市选项 — 既是发布表单的选择项，也是筛选栏的 facet。
export const EVENT_CITIES = [
  'Vancouver',
  'Toronto',
  'Edmonton',
  'Montreal',
  'Waterloo',
  'Ottawa',
  'China',
] as const;

export type EventCityValue = (typeof EVENT_CITIES)[number];

export function isEventCity(v: unknown): v is EventCityValue {
  return typeof v === 'string' && (EVENT_CITIES as readonly string[]).includes(v);
}

export const EVENT_MODES = [
  { value: 'online', label: '线上' },
  { value: 'offline', label: '线下' },
  { value: 'hybrid', label: '线上 + 线下' },
] as const;

export type EventModeValue = (typeof EVENT_MODES)[number]['value'];

export const MODE_LABEL: Record<string, string> = Object.fromEntries(
  EVENT_MODES.map((m) => [m.value, m.label]),
);

export function isEventMode(v: unknown): v is EventModeValue {
  return typeof v === 'string' && v in MODE_LABEL;
}

export const MAX_EVENT_SPEAKERS = 20;

/**
 * Render-time href for member-entered links (meetingUrl / websiteUrl / speaker
 * link). Entry is deliberately unrestricted — any scheme or format is stored
 * as typed. Here we only (1) neutralize script pseudo-schemes (returns null ⇒
 * render as non-link) and (2) prefix scheme-less "www.x.com" with http:// so
 * the anchor doesn't resolve relative to the current page.
 */
export function eventLinkHref(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  if (/^(javascript|data|vbscript):/i.test(v)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('//') || v.startsWith('/')) return v;
  return `http://${v}`;
}

/** Speaker as shipped to clients (and as accepted from the edit form). */
export interface EventSpeakerData {
  name: string;
  title: string;
  org: string;
  avatarUrl: string;
  link: string;
  bio: string;
}

/** Event list/detail item as shipped to client components (authors pre-trimmed). */
export interface PublicEventItem {
  id: string;
  title: string;
  summary: string;
  kind: EventKindValue;
  topics: string[];
  mode: EventModeValue;
  startAt: string; // ISO — REAL UTC instant for timed events; date-only (UTC midnight) when allDay
  endAt: string | null;
  allDay: boolean;
  timezone: string | null; // IANA zone the organizer entered times in; null for allDay
  venue: string | null;
  city: string | null;
  meetingUrl: string | null;
  websiteUrl: string | null;
  coverUrl: string | null;
  pinned: boolean;
  cancelled: boolean;
  speakers: EventSpeakerData[];
  author: PublicAuthor;
  /** Author or admin — may cancel / delete. */
  isOwner: boolean;
  /** Author only — may edit content (mirrors the PATCH route's rule). */
  isAuthor: boolean;
}
