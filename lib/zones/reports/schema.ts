// 版块报告 — report.json v1 的数据契约（docs/contracts/reports.md）。
//
// 这份 zod + 引用校验与独立 skill `chat-report` 的 schema/report.schema.json、
// scripts/validate.mjs 是同一份契约：改字段必须三处同改。模型的每一步输出
// （聚类 / 主题 / 活动与花絮 / 要点）都先过这里，✖ 原样贴回模型重试。
//
// 只依赖 zod，没有 DB、没有 next：tests/zone-reports-schema.test.ts 直接跑。

import { z } from 'zod';

export const REPORT_SCHEMA_VERSION = 1 as const;
export const REPORT_KINDS = ['daily', 'weekly', 'monthly', 'custom'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const MACRO_TAGS = ['共识', '分歧', '判断', '格局', '杠杆', '风险', '进展'] as const;
export const VIEWPOINT_ROLES = ['提出', '回应', '质疑', '补充', '判断', '进展', '结论', '通知'] as const;
export const CONFIDENCES = ['high', 'medium', 'low'] as const;
export const RESOURCE_KINDS = ['paper', 'repo', 'article', 'internal', 'video', 'doc', 'other'] as const;

const MSG_ID_RE = /^m\d+$/;
const THEME_ID_RE = /^t\d{1,2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HTTP_RE = /^https?:\/\//;

// ── 消息（parse.ts 产出；存 ZoneReport.messagesJson） ──────────────────────────

export type MessageType = 'text' | 'image' | 'file' | 'reply' | 'link_card' | 'noise' | 'system';

export interface ParsedLink {
  url: string;
  host: string;
  title: string | null;
}

export interface ParsedAttachment {
  url: string | null;
  kind: 'image' | 'file';
  size: number;
  file: string;
  code: string | null;
  /** 站内：匹配到的 ZoneReportAsset.key（null = 没上传这张图）。 */
  assetKey?: string | null;
  present: boolean | null;
  msgId?: string | null;
}

export interface ParsedMessage {
  id: string;
  msgId: string | null;
  time: string;
  ts: number;
  date: string;
  account: string;
  name: string;
  type: MessageType;
  text: string;
  raw: string;
  links: ParsedLink[];
  mentions: string[];
  replyTo: { id: string | null; account: string; name: string; content: string; messageID: string | null } | null;
  attachments: ParsedAttachment[];
  hasAttachmentPlaceholder: boolean;
  cardTitle?: string | null;
  cardDigest?: string | null;
  cardSource?: string | null;
}

export interface RosterEntry {
  account: string;
  name: string;
  count: number;
  substantive: number;
}

export interface ParsedChat {
  schemaVersion: 1;
  subject: string;
  source: { kind: string; file: string; parsedAt: string };
  period: { start: string; end: string };
  roster: RosterEntry[];
  messages: ParsedMessage[];
  orphanAttachments: (ParsedAttachment & { account: string; name: string; time: string })[];
}

export const SUBSTANTIVE_TYPES: ReadonlySet<MessageType> = new Set(['text', 'reply', 'link_card']);

// ── 模型输出 ①：聚类 ──────────────────────────────────────────────────────────

export const clusterSchema = z.object({
  themes: z
    .array(
      z.object({
        id: z.string().regex(THEME_ID_RE),
        title: z.string().trim().min(1).max(60),
        tagline: z.string().trim().max(200).default(''),
        msgIds: z.array(z.string().regex(MSG_ID_RE)).min(1),
      }),
    )
    .min(1)
    .max(12),
  events: z.array(z.string().regex(MSG_ID_RE)).default([]),
  recap: z.array(z.string().regex(MSG_ID_RE)).default([]),
  skip: z.array(z.string().regex(MSG_ID_RE)).default([]),
});
export type ClusterResult = z.infer<typeof clusterSchema>;

// ── 模型输出 ②：主题 ──────────────────────────────────────────────────────────

const sourceSchema = z.object({
  label: z.string().trim().min(1).max(120),
  url: z.string().regex(HTTP_RE).optional().nullable(),
});

const viewpointSchema = z.object({
  speaker: z.string().trim().min(1).max(60),
  account: z.string().trim().min(1).max(40),
  date: z.string().regex(DATE_RE),
  role: z.enum(VIEWPOINT_ROLES).optional(),
  text: z.string().trim().min(1).max(400),
  quote: z.string().trim().max(200).optional().nullable(),
  sources: z.array(sourceSchema).default([]),
  msgRefs: z.array(z.string().regex(MSG_ID_RE)).min(1),
});

export const themeSchema = z.object({
  id: z.string().regex(THEME_ID_RE),
  title: z.string().trim().min(1).max(60),
  tagline: z.string().trim().min(1).max(200),
  macro: z.array(z.object({ tag: z.enum(MACRO_TAGS), text: z.string().trim().min(1).max(400) })).min(1).max(6),
  viewpoints: z.array(viewpointSchema).min(1).max(20),
  conclusion: z.string().trim().min(1).max(400).nullable(),
  openQuestions: z.array(z.string().trim().min(1).max(200)).max(6).default([]),
  resources: z
    .array(z.object({ label: z.string().trim().min(1).max(120), url: z.string().regex(HTTP_RE), kind: z.enum(RESOURCE_KINDS).optional() }))
    .max(20)
    .default([]),
});
export type ThemeResult = z.infer<typeof themeSchema>;

// ── 模型输出 ③：活动与花絮 ────────────────────────────────────────────────────

export const recapSchema = z.object({
  recap: z
    .object({
      title: z.string().trim().max(60).default('非科研 · 快速 Recap'),
      items: z
        .array(
          z.object({
            text: z.string().trim().min(1).max(300),
            msgRefs: z.array(z.string().regex(MSG_ID_RE)).min(1),
            sources: z.array(sourceSchema).default([]),
          }),
        )
        .max(30)
        .default([]),
    })
    .nullable()
    .default(null),
  events: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(160),
        date: z.string().regex(DATE_RE).nullable().default(null),
        host: z.string().trim().max(80).nullable().default(null),
        url: z.string().regex(HTTP_RE).nullable().default(null),
        note: z.string().trim().max(300).nullable().default(null),
        msgRefs: z.array(z.string().regex(MSG_ID_RE)).min(1),
      }),
    )
    .max(40)
    .default([]),
});
export type RecapResult = z.infer<typeof recapSchema>;

// ── 模型输出 ④：要点 ──────────────────────────────────────────────────────────

const pointerSchema = z.object({ text: z.string().trim().min(1).max(300), themeId: z.string().regex(THEME_ID_RE).nullable().optional() });

export const overviewSchema = z.object({
  headline: z.string().trim().min(1).max(160),
  highlights: z.array(pointerSchema).min(2).max(8),
  judgments: z.array(pointerSchema.extend({ confidence: z.enum(CONFIDENCES) })).min(1).max(6),
  actions: z
    .array(
      pointerSchema.extend({
        owner: z.string().trim().max(80).nullable().optional(),
        ownerAccount: z.string().trim().max(40).nullable().optional(),
        due: z.string().regex(DATE_RE).nullable().optional(),
      }),
    )
    .max(10)
    .default([]),
});
export type OverviewResult = z.infer<typeof overviewSchema>;

// ── 装配后的最终报告 ──────────────────────────────────────────────────────────

export interface ReportViewpoint {
  id: string;
  speaker: string;
  account: string;
  date: string;
  dates: string[];
  role?: (typeof VIEWPOINT_ROLES)[number];
  text: string;
  quote?: string;
  sources: { label: string; url?: string }[];
  msgRefs: string[];
  attachments: string[];
}

export interface ReportTheme {
  id: string;
  title: string;
  tagline: string;
  weight: number;
  msgIds: string[];
  macro: { tag: (typeof MACRO_TAGS)[number]; text: string }[];
  viewpoints: ReportViewpoint[];
  conclusion: string | null;
  openQuestions: string[];
  resources: { label: string; url: string; kind?: (typeof RESOURCE_KINDS)[number] }[];
}

export interface ReportAttachment {
  id: string;
  file: string;
  kind: 'image' | 'file';
  size: number;
  url: string | null;
  code: string | null;
  msgId: string | null;
  account: string;
  name: string;
  time: string;
  present: boolean | null;
  placement: { kind: 'viewpoint' | 'recap' | 'event' | 'appendix'; id?: string };
  /** 站内：ZoneReportAsset.key / 收录后的知识库 slug。 */
  assetKey?: string | null;
  libraryDocSlug?: string | null;
}

export interface ReportStats {
  messages: number;
  substantive: number;
  speakers: number;
  activeDays: number;
  peakDay: { date: string; count: number };
  byType: Record<string, number>;
  byDay: [string, number][];
  bySpeaker: { account: string; name: string; count: number }[];
  links: number;
  linkHosts: [string, number][];
  attachments: number;
  attachmentPlaceholders: number;
}

export interface Report {
  schemaVersion: 1;
  kind: ReportKind;
  title: string;
  subject: string;
  period: { start: string; end: string; label: string };
  generatedAt: string;
  generator: { skill: string; version: string; model: string | null };
  summary: OverviewResult;
  themes: ReportTheme[];
  recap: {
    title: string;
    items: { id: string; text: string; speaker?: string; account?: string; date?: string; sources: { label: string; url?: string }[]; msgRefs: string[]; attachments: string[] }[];
  } | null;
  events: { id: string; title: string; date: string | null; host: string | null; url: string | null; note: string | null; msgRefs: string[]; attachments: string[] }[];
  attachments: ReportAttachment[];
  stats: ReportStats;
  unassigned: string[];
}

// 导入模式用：skill 产出的 report.json 的最小形状校验（装配产物，不是模型输出）。
export const reportSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.enum(REPORT_KINDS),
  title: z.string().min(1).max(200),
  subject: z.string().default(''),
  period: z.object({ start: z.string().regex(DATE_RE), end: z.string().regex(DATE_RE), label: z.string().default('') }),
  generatedAt: z.string().default(''),
  generator: z.object({ skill: z.string().default('chat-report'), version: z.string().default(''), model: z.string().nullable().default(null) }).default({ skill: 'chat-report', version: '', model: null }),
  summary: overviewSchema,
  themes: z.array(z.any()).min(1).max(12),
  recap: z.any().nullable().default(null),
  events: z.array(z.any()).default([]),
  attachments: z.array(z.any()).default([]),
  stats: z.any(),
  unassigned: z.array(z.string()).default([]),
});

// ── 引用校验（与 validate.mjs 同规则） ─────────────────────────────────────────

export interface Validation {
  errors: string[];
  warnings: string[];
}

export interface ChatIndex {
  byId: Map<string, ParsedMessage>;
  accounts: Map<string, string>;
  urls: Set<string>;
}

export function indexChat(chat: ParsedChat): ChatIndex {
  const byId = new Map(chat.messages.map((m) => [m.id, m]));
  const accounts = new Map(chat.roster.map((r) => [r.account, r.name]));
  const urls = new Set<string>();
  for (const m of chat.messages) for (const l of m.links) urls.add(l.url);
  return { byId, accounts, urls };
}

/** 聚类结果：id 存在、不重复、覆盖率 ≥ 85%。 */
export function validateCluster(c: ClusterResult, chat: ParsedChat): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byId = new Map(chat.messages.map((m) => [m.id, m]));
  const seen = new Map<string, string>();
  const use = (id: string, where: string) => {
    if (!byId.has(id)) return errors.push(`${where}: 消息 ${id} 不存在`);
    if (seen.has(id)) warnings.push(`${id} 同时出现在 ${seen.get(id)} 与 ${where}，以先出现者为准`);
    else seen.set(id, where);
  };
  const ids = new Set<string>();
  c.themes.forEach((t, i) => {
    if (ids.has(t.id)) errors.push(`themes[${i}].id 重复：${t.id}`);
    ids.add(t.id);
    if (t.title.length > 40) warnings.push(`themes[${i}].title 超过 40 字`);
    t.msgIds.forEach((id) => use(id, `themes[${i}]`));
    if (t.msgIds.length < 3) warnings.push(`themes[${i}]（${t.title}）只有 ${t.msgIds.length} 条消息，考虑并入其他主题`);
  });
  for (const key of ['recap', 'events', 'skip'] as const) c[key].forEach((id) => use(id, key));
  const substantive = chat.messages.filter((m) => SUBSTANTIVE_TYPES.has(m.type));
  const missing = substantive.filter((m) => !seen.has(m.id));
  const ratio = substantive.length ? 1 - missing.length / substantive.length : 1;
  if (ratio < 0.85) {
    errors.push(
      `覆盖率 ${(ratio * 100).toFixed(0)}%：还有 ${missing.length} 条有信息量的消息没有归类（放进主题 / recap / events / skip 之一）。前 30 条：${missing
        .slice(0, 30)
        .map((m) => m.id)
        .join(' ')}`,
    );
  } else if (missing.length) {
    warnings.push(`${missing.length} 条有信息量消息未归类：${missing.slice(0, 20).map((m) => m.id).join(' ')}`);
  }
  if (c.themes.length > 10) warnings.push('主题多于 10 个，建议合并到 ≤ 8');
  return { errors, warnings };
}

/** 主题摘要：发言人在名单、msgRefs 存在且至少一条是本人、url 在记录里。 */
export function validateTheme(t: ThemeResult, chat: ParsedChat, cluster: ClusterResult | null, index = indexChat(chat)): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const allowed = cluster ? new Set(cluster.themes.find((x) => x.id === t.id)?.msgIds ?? []) : null;
  if (t.tagline.length > 80) warnings.push('tagline 超过 80 字');
  let lastTs = 0;
  t.viewpoints.forEach((v, i) => {
    const vw = `viewpoints[${i}]`;
    const account = v.account.toLowerCase();
    if (!index.accounts.has(account)) errors.push(`${vw}.account "${v.account}" 不在发言人名单里`);
    if (v.text.length > 260) warnings.push(`${vw}.text 超过 260 字（建议 ≤ 200）`);
    for (const id of v.msgRefs) {
      if (!index.byId.has(id)) errors.push(`${vw}.msgRefs 引用了不存在的消息 ${id}`);
      else if (allowed && !allowed.has(id)) warnings.push(`${vw}.msgRefs 引用了不属于本主题的消息 ${id}`);
    }
    const own = v.msgRefs.filter((id) => index.byId.get(id)?.account === account);
    if (v.msgRefs.some((id) => index.byId.has(id)) && !own.length) {
      const names = [...new Set(v.msgRefs.map((id) => index.byId.get(id)?.name).filter(Boolean))].join('、');
      errors.push(`${vw}: msgRefs 里没有一条是 ${v.speaker}（${v.account}）发的——发言人写错了？引用的消息来自 ${names}`);
    }
    v.sources.forEach((s, j) => {
      if (s.url && !index.urls.has(s.url)) errors.push(`${vw}.sources[${j}].url 没有出现在聊天记录里（禁止编造链接）：${s.url}`);
    });
    const ts = Math.min(...v.msgRefs.map((id) => index.byId.get(id)?.ts ?? Infinity));
    if (Number.isFinite(ts)) {
      if (ts < lastTs - 24 * 3600 * 1000) warnings.push(`${vw} 的时间早于上一条观点超过 1 天，观点应按时间顺序排列`);
      lastTs = Math.max(lastTs, ts);
    }
  });
  t.resources.forEach((r, i) => {
    if (!index.urls.has(r.url)) errors.push(`resources[${i}].url 没有出现在聊天记录里：${r.url}`);
  });
  if (t.viewpoints.length > 14) warnings.push(`有 ${t.viewpoints.length} 条观点，建议合并到 ≤ 12`);
  return { errors, warnings };
}

export function validateRecap(r: RecapResult, chat: ParsedChat, index = indexChat(chat)): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  r.recap?.items.forEach((it, i) => {
    it.msgRefs.forEach((id) => {
      if (!index.byId.has(id)) errors.push(`recap.items[${i}].msgRefs 引用不存在的 ${id}`);
    });
    it.sources.forEach((s, j) => {
      if (s.url && !index.urls.has(s.url)) errors.push(`recap.items[${i}].sources[${j}].url 没有出现在聊天记录里：${s.url}`);
    });
  });
  r.events.forEach((ev, i) => {
    ev.msgRefs.forEach((id) => {
      if (!index.byId.has(id)) errors.push(`events[${i}].msgRefs 引用不存在的 ${id}`);
    });
    if (ev.url && !index.urls.has(ev.url)) errors.push(`events[${i}].url 没有出现在聊天记录里：${ev.url}`);
  });
  return { errors, warnings };
}

export function validateOverview(o: OverviewResult, themeIds: ReadonlySet<string>): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (o.headline.length > 80) warnings.push('headline 超过 80 字');
  const check = (key: 'highlights' | 'judgments' | 'actions') =>
    o[key].forEach((it, i) => {
      if (it.themeId && !themeIds.has(it.themeId)) errors.push(`${key}[${i}].themeId "${it.themeId}" 不是已有主题`);
    });
  check('highlights');
  check('judgments');
  check('actions');
  return { errors, warnings };
}

/** 把 zod 的错误压成模型能读懂的一行一条。 */
export function zodIssues(err: z.ZodError): string[] {
  return err.issues.slice(0, 30).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}
