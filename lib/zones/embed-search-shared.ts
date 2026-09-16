// 插入引用 picker — the import-free half of the search contract, shared by the
// route (`app/api/zones/embed/search`), the server pager
// (`lib/zones/embeds.ts#searchEmbedCandidates`) and the client dialog
// (`components/zones/embeds/EmbedPickerDialog.tsx`). No prisma, no React, no
// Node globals: `btoa`/`atob` exist in the browser AND in Node ≥ 16, so the
// cursor codec runs unchanged in tests.
//
// What 我发布的 / 我的收藏 / 最热 MEAN per kind is decided (with the reasoning)
// in the table at the top of the picker-search section of lib/zones/embeds.ts;
// this file only carries the parts both sides must agree on.

import type { EmbedKind } from './shared';

export const EMBED_SEARCH_SCOPES = ['all', 'mine', 'fav'] as const;
export type EmbedSearchScope = (typeof EMBED_SEARCH_SCOPES)[number];

export const EMBED_SEARCH_SORTS = ['new', 'hot'] as const;
export type EmbedSearchSort = (typeof EMBED_SEARCH_SORTS)[number];

/** Kinds the picker lists from the database. `file` comes from the post, `link` is typed in. */
export const SEARCHABLE_EMBED_KINDS = ['library', 'short', 'video', 'skill', 'pack', 'event', 'post'] as const satisfies readonly EmbedKind[];
export type SearchableEmbedKind = (typeof SEARCHABLE_EMBED_KINDS)[number];

export function isSearchableEmbedKind(v: unknown): v is SearchableEmbedKind {
  return typeof v === 'string' && (SEARCHABLE_EMBED_KINDS as readonly string[]).includes(v);
}

/** Rows per page — the owner's 「滚到 20 个后再继续加载」. */
export const EMBED_SEARCH_PAGE_SIZE = 20;

/** Longest keyword the route accepts (the input carries the same `maxLength`). */
export const EMBED_SEARCH_MAX_QUERY = 80;

/**
 * Deepest offset an OFFSET cursor may name. Offsets are `skip`s, so an
 * unbounded one is a cheap way to make Postgres walk a whole table; 2000 rows
 * is 100 pages of scrolling, far past anything a person does in a picker.
 * Only 最热 pages by offset (see `pagingForSort`), and when the cap — rather
 * than the data — ends the stream the pager says so (`truncated`) so the dialog
 * can ask for a keyword instead of claiming 已经到底了.
 */
export const EMBED_SEARCH_MAX_OFFSET = 2000;

/**
 * Scopes each kind offers, in display order. A kind without a publisher
 * concept has no 我发布的, one without a per-viewer save has no 我的收藏; the
 * dialog hides what is not listed and the route 400s it.
 * - 合集包 are curated by admins (`createdById` is an operator, not an author)
 *   and have no favourite model — 全部 only.
 */
export const EMBED_SEARCH_SCOPES_BY_KIND: Readonly<Record<SearchableEmbedKind, readonly EmbedSearchScope[]>> = {
  library: ['all', 'mine', 'fav'],
  short: ['all', 'mine', 'fav'],
  video: ['all', 'mine', 'fav'],
  skill: ['all', 'mine', 'fav'],
  pack: ['all'],
  event: ['all', 'mine', 'fav'],
  post: ['all', 'mine', 'fav'],
};

export function scopesForKind(kind: SearchableEmbedKind): readonly EmbedSearchScope[] {
  return EMBED_SEARCH_SCOPES_BY_KIND[kind];
}

/** `null` = the value is not a scope at all, or not one this kind offers. */
export function parseEmbedSearchScope(kind: SearchableEmbedKind, raw: string | null): EmbedSearchScope | null {
  if (raw === null || raw === '') return 'all';
  return (scopesForKind(kind) as readonly string[]).includes(raw) ? (raw as EmbedSearchScope) : null;
}

export function parseEmbedSearchSort(raw: string | null): EmbedSearchSort | null {
  if (raw === null || raw === '') return 'new';
  return (EMBED_SEARCH_SORTS as readonly string[]).includes(raw) ? (raw as EmbedSearchSort) : null;
}

// ── phases ───────────────────────────────────────────────────────────────────

/**
 * The publisher half of a phase:
 * - `mine` — the viewer's own rows (gate AND publisher = viewer)
 * - `rest` — everyone else's (gate AND publisher ≠ viewer)
 * - `all`  — no publisher split (a kind with no publisher concept)
 * - `fav`  — the viewer's saved rows (gate AND saved by viewer)
 * `mine` + `rest` partition the gated set exactly, which is what makes 全部 =
 * 「自己的在前」 with no duplicates and no gaps across pages.
 */
export type EmbedPhaseGroup = 'mine' | 'rest' | 'all' | 'fav';

/**
 * 活动 under 最新 splits every group in two — `up` (still to happen, soonest
 * first) then `past` (most recent first). 「最新」 for an event means the event
 * itself, not when its listing was typed up, and an author embedding one nearly
 * always means an upcoming one. The two halves must cover the gated set between
 * them the way `mine` + `rest` do, or the pager's no-gap guarantee breaks; how
 * that is built (and why it is NOT a SQL `NOT`) lives in embeds.ts#eventSource.
 */
export type EmbedPhaseSlice = 'up' | 'past';

/** One ordered slice of the result stream, each a single SQL query shape. */
export type EmbedSearchPhase = EmbedPhaseGroup | `${EmbedPhaseGroup}:${EmbedPhaseSlice}`;

export function phaseGroup(phase: EmbedSearchPhase): EmbedPhaseGroup {
  const sep = phase.indexOf(':');
  return (sep < 0 ? phase : phase.slice(0, sep)) as EmbedPhaseGroup;
}

/** `null` = the kind/sort does not slice this phase (everything but 活动 under 最新). */
export function phaseSlice(phase: EmbedSearchPhase): EmbedPhaseSlice | null {
  const sep = phase.indexOf(':');
  return sep < 0 ? null : (phase.slice(sep + 1) as EmbedPhaseSlice);
}

export function phasesFor(
  kind: SearchableEmbedKind,
  scope: EmbedSearchScope,
  sort: EmbedSearchSort = 'new',
): readonly EmbedSearchPhase[] {
  const offered = scopesForKind(kind);
  let groups: readonly EmbedPhaseGroup[];
  if (scope === 'mine') groups = offered.includes('mine') ? ['mine'] : [];
  else if (scope === 'fav') groups = offered.includes('fav') ? ['fav'] : [];
  else groups = offered.includes('mine') ? ['mine', 'rest'] : ['all'];
  if (kind === 'event' && sort === 'new') {
    return groups.flatMap((g) => [`${g}:up`, `${g}:past`] as EmbedSearchPhase[]);
  }
  return groups;
}

// ── cursor ───────────────────────────────────────────────────────────────────

/**
 * How a sort pages. 最新 orders by a time column, so it pages by KEYSET (the
 * last row's `<time>|<id>`): a row deleted or published between two pages
 * shifts nothing, where `skip` silently drops or repeats one. 最热 orders by
 * counters that any view or like moves, so no key is stable — it keeps offset
 * paging and accepts that drift (the same trade the zone hub feed makes).
 */
export type EmbedPaging = 'offset' | 'keyset';

export function pagingForSort(sort: EmbedSearchSort): EmbedPaging {
  return sort === 'hot' ? 'offset' : 'keyset';
}

/** The last row of a page in `[<time column>, id]` order. `at: null` = that column is NULL on the row. */
export interface EmbedKeysetKey {
  at: Date | null;
  id: string;
}

/** Where the next page starts: an offset into a phase, or the row it continues after (`null` = the phase's first row). */
export type EmbedSearchCursor =
  | { phase: EmbedSearchPhase; offset: number; after?: never }
  | { phase: EmbedSearchPhase; after: EmbedKeysetKey | null; offset?: never };

export function isKeysetCursor(cursor: EmbedSearchCursor): cursor is { phase: EmbedSearchPhase; after: EmbedKeysetKey | null } {
  return 'after' in cursor;
}

const CURSOR_VERSION = 2;
/** An ISO instant + a cuid inside base64url JSON is ~130 characters. */
const MAX_CURSOR_LENGTH = 200;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
/** Row ids are cuids; anything else in the key half is a forged cursor. */
const KEY_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function toBase64Url(ascii: string): string {
  return btoa(ascii).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string | null {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  } catch {
    return null;
  }
}

/**
 * Opaque to the client: base64url of `{"v":2,"p":<phase>,"o":<offset>}` (最热)
 * or `{"v":2,"p":<phase>,"k":"<iso>|<id>"}` (最新; `k: null` = the phase's
 * first row, an empty instant = that row's key column is NULL).
 */
export function encodeEmbedSearchCursor(cursor: EmbedSearchCursor): string {
  const body = isKeysetCursor(cursor)
    ? { v: CURSOR_VERSION, p: cursor.phase, k: cursor.after ? `${cursor.after.at ? cursor.after.at.toISOString() : ''}|${cursor.after.id}` : null }
    : { v: CURSOR_VERSION, p: cursor.phase, o: cursor.offset };
  return toBase64Url(JSON.stringify(body));
}

/**
 * `null` = garbage (the route answers 400). A cursor is only valid for the
 * phase list AND the paging mode of the request it continues — a `fav` cursor
 * replayed against 全部, a `mine` cursor against 合集包, or a 最热 offset cursor
 * replayed against 最新, is rejected rather than reinterpreted.
 */
export function decodeEmbedSearchCursor(
  raw: string,
  phases: readonly EmbedSearchPhase[],
  paging: EmbedPaging = 'offset',
): EmbedSearchCursor | null {
  if (!raw || raw.length > MAX_CURSOR_LENGTH || !BASE64URL_RE.test(raw)) return null;
  const json = fromBase64Url(raw);
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const { v, p, o, k } = parsed as { v?: unknown; p?: unknown; o?: unknown; k?: unknown };
  if (v !== CURSOR_VERSION) return null;
  if (typeof p !== 'string' || !(phases as readonly string[]).includes(p)) return null;
  const phase = p as EmbedSearchPhase;

  if (paging === 'offset') {
    if (typeof o !== 'number' || !Number.isInteger(o) || o < 0 || o > EMBED_SEARCH_MAX_OFFSET) return null;
    return { phase, offset: o };
  }
  if (k === null) return { phase, after: null };
  if (typeof k !== 'string') return null;
  const sep = k.indexOf('|');
  if (sep < 0) return null;
  const id = k.slice(sep + 1);
  if (!KEY_ID_RE.test(id)) return null;
  const rawAt = k.slice(0, sep);
  if (rawAt === '') return { phase, after: { at: null, id } };
  const at = new Date(rawAt);
  if (Number.isNaN(at.getTime())) return null;
  return { phase, after: { at, id } };
}

// ── pager ────────────────────────────────────────────────────────────────────

/** Where inside a phase a fetch starts — the cursor's position, minus the phase. */
export type EmbedPhasePosition = { offset: number; after?: never } | { after: EmbedKeysetKey | null; offset?: never };

export function isKeysetPosition(p: EmbedPhasePosition): p is { after: EmbedKeysetKey | null } {
  return 'after' in p;
}

export type EmbedPhaseFetcher<T> = (phase: EmbedSearchPhase, position: EmbedPhasePosition, take: number) => Promise<T[]>;

export interface EmbedPagerOptions<T> {
  /** Defaults to `offset`. */
  paging?: EmbedPaging;
  /** Required for `keyset`: the sort key of a row, used to mint the cursor that continues after it. */
  keyOf?: (row: T) => EmbedKeysetKey;
}

export interface EmbedPagerResult<T> {
  rows: T[];
  next: EmbedSearchCursor | null;
  /**
   * The offset CAP ended the stream although rows remained — not the data.
   * `next: null` alone would read as 已经到底了 while rows sit unreachable.
   */
  truncated: boolean;
}

function positionOf(cursor: EmbedSearchCursor): EmbedPhasePosition {
  return isKeysetCursor(cursor) ? { after: cursor.after } : { offset: cursor.offset };
}

function cursorAt(phase: EmbedSearchPhase, position: EmbedPhasePosition): EmbedSearchCursor {
  return isKeysetPosition(position) ? { phase, after: position.after } : { phase, offset: position.offset };
}

/**
 * Fill ONE page from an ordered list of phases, starting at `start` (null =
 * the first phase at its first row). Each call asks for one row more than it
 * needs, so "is there more?" never costs a count query. When a page fills
 * exactly at a phase boundary the next phase is probed with `take: 1`, so the
 * last page answers `next: null` instead of handing out a cursor to an empty
 * page (which would flash a spinner and then 已经到底了).
 */
export async function paginateEmbedPhases<T>(
  phases: readonly EmbedSearchPhase[],
  start: EmbedSearchCursor | null,
  pageSize: number,
  fetchPhase: EmbedPhaseFetcher<T>,
  opts: EmbedPagerOptions<T> = {},
): Promise<EmbedPagerResult<T>> {
  const paging = opts.paging ?? 'offset';
  const phaseStart: EmbedPhasePosition = paging === 'keyset' ? { after: null } : { offset: 0 };
  const rows: T[] = [];
  let index = start ? phases.indexOf(start.phase) : 0;
  if (index < 0) return { rows, next: null, truncated: false };
  let position: EmbedPhasePosition = start ? positionOf(start) : phaseStart;

  while (index < phases.length) {
    const phase = phases[index];
    const need = pageSize - rows.length;
    if (need === 0) {
      const probe = await fetchPhase(phase, position, 1);
      if (probe.length > 0) return { rows, next: cursorAt(phase, position), truncated: false };
    } else {
      const got = await fetchPhase(phase, position, need + 1);
      if (got.length > need) {
        const page = got.slice(0, need);
        rows.push(...page);
        if (paging === 'keyset') {
          const keyOf = opts.keyOf;
          if (!keyOf) throw new Error('paginateEmbedPhases: keyset paging needs keyOf');
          return { rows, next: { phase, after: keyOf(page[page.length - 1]) }, truncated: false };
        }
        const nextOffset = (isKeysetPosition(position) ? 0 : position.offset) + need;
        // Past the deepest offset a cursor may carry: end the stream here rather
        // than mint a cursor the route would reject — and SAY it was the cap, so
        // the dialog asks for a keyword instead of claiming the list is complete.
        if (nextOffset > EMBED_SEARCH_MAX_OFFSET) return { rows, next: null, truncated: true };
        return { rows, next: { phase, offset: nextOffset }, truncated: false };
      }
      rows.push(...got);
    }
    index += 1;
    position = phaseStart;
  }
  return { rows, next: null, truncated: false };
}

/** First non-blank string — a row's TITLE falls back through name / summary, never to its ref. */
export function firstNonBlank(...values: (string | null | undefined)[]): string {
  for (const v of values) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s) return s;
  }
  return '';
}
