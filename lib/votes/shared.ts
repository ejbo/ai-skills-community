// 投票活动 shared helpers — IMPORT-FREE by contract (like lib/video/shorts-shared.ts):
// client components import this directly, so nothing here may reach zod / node
// builtins / next-intl. Callers pass translated text in; this file only computes.

// ─── 文件名解析规则 ─────────────────────────────────────────────────────────
// The organizer bulk-uploads works whose filenames encode metadata, e.g.
// "参赛-张三-a12345678-日落时分v2.mp4". A rule strips a literal prefix and the
// extension, splits the rest on a SET of delimiter characters, then maps
// segments onto 作品名 / 作者 / 工号. Applied server-side at upload and via
// 重新应用; rows the organizer hand-edited (titleEdited) are never overwritten.

export type VoteFieldPick =
  | { mode: 'none' } // 不提取
  | { mode: 'full' } // 整个文件名（去前缀去扩展名后）
  | { mode: 'segment'; index: number } // 第 index+1 段
  | { mode: 'from'; index: number }; // 第 index+1 段起到结尾（作品名常含分隔符）

export interface VoteNameRule {
  stripExt: boolean;
  /** Literal prefix stripped before splitting ('' = none). */
  prefix: string;
  /** Each character is a delimiter; runs of them split segments ('' = no split). */
  delimiter: string;
  title: VoteFieldPick;
  author: VoteFieldPick;
  authorNo: VoteFieldPick;
}

export const DEFAULT_NAME_RULE: VoteNameRule = {
  stripExt: true,
  prefix: '',
  delimiter: '-_',
  title: { mode: 'full' },
  author: { mode: 'none' },
  authorNo: { mode: 'none' },
};

export interface ParsedEntryName {
  title: string;
  authorName: string;
  authorNo: string;
}

const MAX_SEGMENT_INDEX = 19;

function escapeRegExp(s: string): string {
  // '-' included: these strings land inside a character class, where a bare
  // '-' forms ranges ("0-9") or throws outright ("z-a").
  return s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
}

function pickField(pick: VoteFieldPick, base: string, segments: string[], joiner: string): string {
  switch (pick.mode) {
    case 'none':
      return '';
    case 'full':
      return base;
    case 'segment':
      return segments[pick.index] ?? '';
    case 'from':
      return segments.slice(pick.index).join(joiner);
    default:
      return '';
  }
}

/** Apply a name rule to an original filename. Missing segments resolve to ''. */
export function applyNameRule(filename: string, rule: VoteNameRule): ParsedEntryName {
  // File.name never carries a path, but be defensive about pasted values.
  let base = filename.split('/').pop()?.split('\\').pop() ?? '';
  if (rule.stripExt) base = base.replace(/\.[A-Za-z0-9]{1,8}$/, '');
  if (rule.prefix && base.startsWith(rule.prefix)) base = base.slice(rule.prefix.length);
  base = base.trim();

  let segments: string[] = [base];
  if (rule.delimiter) {
    const cls = new RegExp(`[${escapeRegExp(rule.delimiter)}]+`);
    segments = base
      .split(cls)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  const joiner = rule.delimiter ? rule.delimiter[0] : '';

  const title = pickField(rule.title, base, segments, joiner).trim().slice(0, 120);
  const authorName = pickField(rule.author, base, segments, joiner).trim().slice(0, 60);
  // 工号 stored lowercase — the EmployeeDirectory contract (case-insensitive lookups).
  const authorNo = pickField(rule.authorNo, base, segments, joiner).trim().slice(0, 30).toLowerCase();
  return { title, authorName, authorNo };
}

function parseFieldPick(raw: unknown): VoteFieldPick | null {
  if (!raw || typeof raw !== 'object') return null;
  const mode = (raw as { mode?: unknown }).mode;
  if (mode === 'none' || mode === 'full') return { mode };
  if (mode === 'segment' || mode === 'from') {
    const index = (raw as { index?: unknown }).index;
    if (typeof index !== 'number' || !Number.isInteger(index)) return null;
    if (index < 0 || index > MAX_SEGMENT_INDEX) return null;
    return { mode, index };
  }
  return null;
}

/** Validate an untrusted (stored JSON / client) rule. Null when malformed. */
export function parseNameRule(raw: unknown): VoteNameRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.stripExt !== 'boolean') return null;
  if (typeof o.prefix !== 'string' || o.prefix.length > 60) return null;
  if (typeof o.delimiter !== 'string' || o.delimiter.length > 8) return null;
  const title = parseFieldPick(o.title);
  const author = parseFieldPick(o.author);
  const authorNo = parseFieldPick(o.authorNo);
  if (!title || !author || !authorNo) return null;
  return { stripExt: o.stripExt, prefix: o.prefix, delimiter: o.delimiter, title, author, authorNo };
}

// ─── 投票窗口 ───────────────────────────────────────────────────────────────
// The single open/over predicate shared by queries, the vote route and the UI
// (mirrors the events `eventOverAt` rule: gates must agree with visibility).

type DateLike = Date | string | null | undefined;

function toDate(v: DateLike): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface VoteWindow {
  startAt: DateLike;
  endAt: DateLike;
  closedAt: DateLike;
}

/** 已结束：提前结束或截止时间已过。 */
export function voteOver(w: VoteWindow, now: Date = new Date()): boolean {
  if (toDate(w.closedAt)) return true;
  const end = toDate(w.endAt);
  return end !== null && end.getTime() <= now.getTime();
}

/** 已开始：无定时开始，或开始时间已到。 */
export function voteStarted(w: VoteWindow, now: Date = new Date()): boolean {
  const start = toDate(w.startAt);
  return start === null || start.getTime() <= now.getTime();
}

/** 可投票：已发布 + 已开始 + 未结束。 */
export function votingOpen(status: string, w: VoteWindow, now: Date = new Date()): boolean {
  return status === 'published' && voteStarted(w, now) && !voteOver(w, now);
}

// ─── 每日票数桶 ─────────────────────────────────────────────────────────────
// daily 预算按固定的北京时间刷新（确定性、可解释：“每日票数按北京时间 0 点刷新”）。
// total 模式的 ballots 存 day='' — the composite PK scopes budgets per bucket.

export function voteDayKey(period: 'total' | 'daily', now: Date = new Date()): string {
  if (period !== 'daily') return '';
  // en-CA yields YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

// ─── 种子乱序 ───────────────────────────────────────────────────────────────
// Per-viewer deterministic shuffle (GuruShots-style position-bias removal):
// same viewer always sees the same order (stable across reloads, so the
// lightbox prev/next and “搜 42 号” stay coherent), different viewers see
// different orders. Seed = fnv1a(viewerKey + activityId).

export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates with a deterministic PRNG. Returns a NEW array. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = items.slice();
  const rand = mulberry32(fnv1a(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ─── 名次 ───────────────────────────────────────────────────────────────────
// Competition ranking (1, 1, 3): tied counts share a rank, the next rank skips.
// Input must already be sorted by count DESC; returns the rank per position.

export function competitionRanks(sortedCounts: readonly number[]): number[] {
  const ranks: number[] = [];
  for (let i = 0; i < sortedCounts.length; i++) {
    if (i > 0 && sortedCounts[i] === sortedCounts[i - 1]) {
      ranks.push(ranks[i - 1]);
    } else {
      ranks.push(i + 1);
    }
  }
  return ranks;
}

// ─── 自定义投稿表单字段 ──────────────────────────────────────────────────────
// 发起人在「成员投稿」里定义的额外文本字段；答案存 VoteEntry.formData
// { [field.id]: answer }。id 客户端生成、创建后不变（答案靠它对齐）。

export interface VoteCustomField {
  id: string;
  label: string;
  required: boolean;
}

export const MAX_CUSTOM_FIELDS = 8;
export const CUSTOM_FIELD_LABEL_MAX = 40;
export const CUSTOM_FIELD_ANSWER_MAX = 200;

/** Validate untrusted (stored JSON / client) custom-field defs. Null = malformed. */
export function parseCustomFields(raw: unknown): VoteCustomField[] | null {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_CUSTOM_FIELDS) return null;
  const out: VoteCustomField[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== 'string' || !/^[A-Za-z0-9_-]{1,24}$/.test(o.id)) return null;
    if (seen.has(o.id)) return null;
    if (typeof o.label !== 'string') return null;
    const label = o.label.trim();
    if (!label || label.length > CUSTOM_FIELD_LABEL_MAX) return null;
    if (typeof o.required !== 'boolean') return null;
    seen.add(o.id);
    out.push({ id: o.id, label, required: o.required });
  }
  return out;
}

/**
 * Validate submitted answers against the field defs: required must be
 * non-empty, unknown ids are dropped, everything trimmed and clamped.
 * Returns null when a required field is missing.
 */
export function resolveCustomAnswers(
  fields: VoteCustomField[],
  raw: unknown,
): Record<string, string> | null {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: Record<string, string> = {};
  for (const field of fields) {
    const v = typeof input[field.id] === 'string' ? (input[field.id] as string).trim() : '';
    const clamped = v.slice(0, CUSTOM_FIELD_ANSWER_MAX);
    if (field.required && !clamped) return null;
    if (clamped) out[field.id] = clamped;
  }
  return out;
}

// ─── 校验边界（create/edit 表单与 API 共用） ─────────────────────────────────
export const VOTE_TITLE_MAX = 80;
export const VOTE_DESCRIPTION_MAX = 20000;
export const VOTE_ANNOUNCEMENT_MAX = 200;
export const VOTES_PER_USER_MAX = 1000;
export const MAX_PER_ENTRY_MAX = 1000;
export const VOTE_ENTRY_TITLE_MAX = 120;
export const VOTE_ENTRY_AUTHOR_MAX = 60;
export const VOTE_ENTRY_AUTHOR_NO_MAX = 30;
export const VOTE_ENTRY_DESCRIPTION_MAX = 2000;
export const VOTE_COMMENT_MAX = 1000;
