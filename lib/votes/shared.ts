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

// ─── 时区 ───────────────────────────────────────────────────────────────────
// 开始/截止时间存的是真实 UTC 瞬时；`VoteActivity.timezone` 记录发起人填写时
// 用的 IANA 时区，所以编辑器能把瞬时还原成他当初输入的墙上时间，前台也能标
// 「东部时间 10:00」而不是让每个观众自己换算。选项刻意只有加东/加西（团队所在
// 地）——固定集合意味着展示文案走 i18n key，入库值永远是 IANA 名。
// 注意：daily 预算桶（voteDayKey）仍按北京时间刷新，与这里无关。

export const VOTE_TIMEZONES = [
  { value: 'America/Toronto', key: 'tz_eastern' },
  { value: 'America/Vancouver', key: 'tz_western' },
] as const;

export type VoteTimezoneValue = (typeof VOTE_TIMEZONES)[number]['value'];

export const DEFAULT_VOTE_TIMEZONE: VoteTimezoneValue = 'America/Toronto';

const VOTE_TZ_KEY: Record<string, string> = Object.fromEntries(
  VOTE_TIMEZONES.map((tz) => [tz.value, tz.key]),
);

export function isVoteTimezone(v: unknown): v is VoteTimezoneValue {
  // hasOwnProperty, NOT `in` — Object.fromEntries inherits Object.prototype, so
  // `'toString' in VOTE_TZ_KEY` is true and a PATCH could store it as a zone.
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(VOTE_TZ_KEY, v);
}

/** i18n key for a zone's short label. Unknown/legacy zones fall back to the default. */
export function voteTimezoneKey(zone: string | null | undefined): string {
  return isVoteTimezone(zone) ? VOTE_TZ_KEY[zone] : VOTE_TZ_KEY[DEFAULT_VOTE_TIMEZONE];
}

/** The zone a row's times are expressed in (legacy null rows = the default). */
export function voteTimezoneOf(zone: string | null | undefined): VoteTimezoneValue {
  return isVoteTimezone(zone) ? zone : DEFAULT_VOTE_TIMEZONE;
}

/**
 * 夏令时"春季跳变"当天，02:00–03:00 这一小时在墙上时钟里根本不存在。裸的
 * zonedWallToUtc 会把 02:30 解析成和 01:30 完全相同的瞬时 —— 于是"截止 02:30"
 * 悄悄提前一小时，而"开始 01:30 / 截止 02:30"两个不同的钟面折叠成同一瞬时，
 * 服务端的成对校验会莫名其妙报"截止时间必须晚于开始时间"。
 *
 * 这里做一次回投影校验：如果换算回去得到的不是用户输入的钟面，说明落在缺口里，
 * 就按差值**向后推**到跳变之后的瞬时（02:30 → 03:30），与 java.time 等主流实现
 * 一致。传入的 convert/project 就是 lib/events/time.ts 的那两个函数（保持本文件
 * import-free）。
 */
export function resolveWallToInstant(
  date: string,
  time: string,
  zone: string,
  convert: (date: string, time: string, zone: string) => Date | null,
  project: (instant: Date, zone: string) => Date,
): Date | null {
  const instant = convert(date, time, zone);
  if (!instant) return null;
  const wall = project(instant, zone);
  const pad = (n: number) => String(n).padStart(2, '0');
  const got = `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())} ${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}`;
  const want = `${date} ${time}`;
  if (got === want) return instant;
  // 缺口：把"想要的钟面 − 实际落到的钟面"补回去。
  const wantMs = convert(date, time, 'UTC')?.getTime();
  const gotMs = Date.UTC(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate(),
    wall.getUTCHours(),
    wall.getUTCMinutes(),
  );
  if (wantMs === undefined) return instant;
  return new Date(instant.getTime() + (wantMs - gotMs));
}

/**
 * 把 UTC 瞬时按活动自己的时区渲染成「2026年8月30日 10:00」。显式传 timeZone，
 * 所以服务端和客户端算出来的是同一个字符串（不会 hydration mismatch），也不需要
 * 客户端叶子组件。展示时在后面接上时区短名（东部/西部）才完整。
 */
export function formatVoteInstant(iso: string, zone: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: voteTimezoneOf(zone),
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
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

// ─── 封面裁切 ───────────────────────────────────────────────────────────────
// posterPos 三态：'' = 居中裁切（object-cover center，默认）；'contain' =
// 完整显示（模糊铺底 + contain）；'50% 30%' = object-cover + object-position
// 选区（PosterCropEditor 拖出来的取景框位置）。

export type VotePosterAspect = 'landscape' | 'portrait';
export const VOTE_POSTER_ASPECTS: VotePosterAspect[] = ['landscape', 'portrait'];

/** Normalize an untrusted posterPos. Null = malformed (caller 400s). */
export function parsePosterPos(raw: unknown): string | null {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (s === '' || s === 'contain') return s;
  const m = /^(\d{1,3})% (\d{1,3})%$/.exec(s);
  if (!m) return null;
  const x = Number(m[1]);
  const y = Number(m[2]);
  if (x > 100 || y > 100) return null;
  return `${x}% ${y}%`;
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

// ─── 批量投票（先选、后统一提交） ───────────────────────────────────────────
// The gallery keeps a LOCAL draft (desired count per entry) and submits it in
// ONE request; the server applies the same arithmetic against the ballot rows
// inside its Serializable tx. Both sides share these pure helpers so the client
// can refuse a click for exactly the reason the server would reject it.

export interface BallotRules {
  votesPerUser: number;
  maxPerEntry: number;
  allowRevoke: boolean;
}

/** One submitted change: the DESIRED total on that entry (idempotent on retry). */
export interface BallotChange {
  entryId: string;
  count: number;
}

// Adds + revokes can each touch up to VOTES_PER_USER_MAX entries.
export const MAX_BALLOT_CHANGES = 2000;

export type BallotPlanError = 'budget_exhausted' | 'entry_cap' | 'revoke_forbidden' | 'invalid_input';

export interface BallotPlanStep {
  entryId: string;
  from: number;
  to: number;
}

export interface BallotPlan {
  /** Only entries whose count actually moves — a no-op change is dropped. */
  steps: BallotPlanStep[];
  /** Budget used after the steps apply. */
  used: number;
}

export type BallotPlanResult =
  | { ok: true; plan: BallotPlan }
  | { ok: false; error: BallotPlanError; entryId?: string };

/**
 * Diff the desired counts against the current ballots under the rules.
 * `current` maps entryId → committed count in the active budget bucket and
 * must include EVERY entry the user has votes on (the total is derived from
 * it). Entries not mentioned in `changes` are untouched.
 */
export function planBallotChanges(
  rules: BallotRules,
  current: ReadonlyMap<string, number>,
  changes: readonly BallotChange[],
): BallotPlanResult {
  if (changes.length > MAX_BALLOT_CHANGES) return { ok: false, error: 'invalid_input' };
  const seen = new Set<string>();
  const steps: BallotPlanStep[] = [];
  let used = 0;
  let adds = 0;
  for (const c of current.values()) used += c;
  for (const change of changes) {
    if (!Number.isInteger(change.count) || change.count < 0) {
      return { ok: false, error: 'invalid_input', entryId: change.entryId };
    }
    if (seen.has(change.entryId)) return { ok: false, error: 'invalid_input', entryId: change.entryId };
    seen.add(change.entryId);
    const from = current.get(change.entryId) ?? 0;
    const to = change.count;
    if (to === from) continue;
    // The cap and the budget only gate INCREASES. A creator may lower
    // maxPerEntry / votesPerUser after ballots exist; a voter who is now over
    // the new limit must still be able to 撤回 (never trap a voter's budget).
    if (to > from && to > rules.maxPerEntry) return { ok: false, error: 'entry_cap', entryId: change.entryId };
    if (to < from && !rules.allowRevoke) {
      return { ok: false, error: 'revoke_forbidden', entryId: change.entryId };
    }
    if (to > from) adds += to - from;
    used += to - from;
    steps.push({ entryId: change.entryId, from, to });
  }
  if (adds > 0 && used > rules.votesPerUser) return { ok: false, error: 'budget_exhausted' };
  return { ok: true, plan: { steps, used } };
}

export type DraftStepError = 'budget_exhausted' | 'entry_cap' | 'revoke_forbidden' | 'nothing_to_remove';

export type DraftStepResult = { ok: true; next: number } | { ok: false; error: DraftStepError };

/**
 * One click on a card: move the draft count for an entry by ±1.
 * `committed` = the server's count for that entry, `draft` = the current
 * local count, `remaining` = budget left AFTER the whole draft is applied.
 * Taking back a not-yet-submitted vote is always allowed; going BELOW the
 * committed count is 撤票 and needs allowRevoke.
 */
export function stepDraftCount(
  rules: BallotRules,
  committed: number,
  draft: number,
  delta: 1 | -1,
  remaining: number,
): DraftStepResult {
  if (delta > 0) {
    if (draft + 1 > rules.maxPerEntry) return { ok: false, error: 'entry_cap' };
    if (remaining <= 0) return { ok: false, error: 'budget_exhausted' };
    return { ok: true, next: draft + 1 };
  }
  if (draft <= 0) return { ok: false, error: 'nothing_to_remove' };
  if (draft - 1 < committed && !rules.allowRevoke) return { ok: false, error: 'revoke_forbidden' };
  return { ok: true, next: draft - 1 };
}

/** The gallery's local draft: desired count per entry, ONLY where it differs from the committed count. */
export type BallotDraft = Record<string, number>;

export interface DraftReconcile {
  next: BallotDraft;
  /** Something was changed BY THE RULES (cap/budget), not merely pruned as redundant — worth telling the user. */
  trimmed: boolean;
  changed: boolean;
}

/**
 * Re-validate a draft against fresh server state (poll, submit error, reload):
 * drop overrides for entries that vanished or that now equal the committed
 * count, clamp pending ADDS to maxPerEntry, and shed pending adds (newest
 * first) while the draft would exceed votesPerUser. Revokes are never touched —
 * they are always allowed by planBallotChanges. `committed` must map every
 * visible entry to its myVotes; `budgetUsed` is the server's total in the bucket
 * (including ballots on entries the viewer cannot see).
 */
export function reconcileDraft(
  rules: BallotRules,
  open: boolean,
  budgetUsed: number,
  committed: ReadonlyMap<string, number>,
  draft: BallotDraft,
): DraftReconcile {
  const next: BallotDraft = {};
  let trimmed = false;
  let changed = false;
  let used = budgetUsed;
  const ids: string[] = [];
  for (const id in draft) {
    const mine = committed.get(id);
    if (!open || mine === undefined) {
      changed = true;
      continue;
    }
    let count = draft[id];
    if (!Number.isInteger(count) || count < 0) {
      changed = true;
      continue;
    }
    if (count > mine && count > rules.maxPerEntry) {
      count = Math.max(mine, rules.maxPerEntry);
      trimmed = true;
    }
    if (count === mine) {
      changed = true;
      continue;
    }
    next[id] = count;
    ids.push(id);
    used += count - mine;
  }
  if (used > rules.votesPerUser) {
    for (let i = ids.length - 1; i >= 0 && used > rules.votesPerUser; i--) {
      const id = ids[i];
      const mine = committed.get(id) ?? 0;
      while (next[id] > mine && used > rules.votesPerUser) {
        next[id] -= 1;
        used -= 1;
        trimmed = true;
      }
      if (next[id] === mine) delete next[id];
    }
  }
  return { next, trimmed, changed: changed || trimmed };
}
