// Pure half of the 插入引用 dialog (EmbedPickerDialog.tsx): URL building,
// response validation, the list state machine and the per-kind label keys.
// React-free and import-light so tests/embed-picker-search.test.ts runs it as is.
//
// The list is a small reducer rather than loose useState calls because the
// dialog has THREE writers that can race — the debounced first page, the
// infinite-scroll page and the retry button — and a stale answer must never
// land in a newer list. Every request carries a monotonically increasing
// `reqId`; the reducer accepts a page/error only when it names the request the
// state is currently waiting for. A kind/scope/sort/keyword change is a `reset`
// with a fresh id, which silently orphans whatever was still in flight.

import type { EmbedSearchScope, EmbedSearchSort, SearchableEmbedKind } from '@/lib/zones/embed-search-shared';
import type { EmbedCandidate, EmbedSearchPage } from '@/lib/zones/types';

export interface EmbedSearchParams {
  kind: SearchableEmbedKind;
  q: string;
  scope: EmbedSearchScope;
  sort: EmbedSearchSort;
  cursor: string | null;
}

/** Root-relative — the fetch shim (lib/patch-fetch.ts) adds the deploy basePath. */
export function embedSearchUrl(p: EmbedSearchParams): string {
  const sp = new URLSearchParams({ kind: p.kind, scope: p.scope, sort: p.sort });
  const q = p.q.trim();
  if (q) sp.set('q', q);
  if (p.cursor) sp.set('cursor', p.cursor);
  return `/api/zones/embed/search?${sp.toString()}`;
}

function isCandidate(v: unknown): v is EmbedCandidate {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.kind === 'string' &&
    typeof c.ref === 'string' &&
    typeof c.title === 'string' &&
    typeof c.subtitle === 'string' &&
    (c.imageUrl === null || typeof c.imageUrl === 'string') &&
    typeof c.updatedAt === 'string' &&
    typeof c.mine === 'boolean' &&
    typeof c.favorited === 'boolean' &&
    (c.edited === undefined || typeof c.edited === 'boolean')
  );
}

/** `null` = not a page this endpoint produces (an error body, a proxy's HTML…). */
export function parseEmbedSearchPage(data: unknown): EmbedSearchPage | null {
  if (!data || typeof data !== 'object') return null;
  const { items, nextCursor, truncated } = data as { items?: unknown; nextCursor?: unknown; truncated?: unknown };
  if (!Array.isArray(items) || !(nextCursor === null || typeof nextCursor === 'string')) return null;
  // A body from before `truncated` existed (or a cached one) simply means "the
  // data ended", which is the honest default.
  return { items: items.filter(isCandidate), nextCursor, truncated: truncated === true };
}

const candidateKey = (c: Pick<EmbedCandidate, 'kind' | 'ref'>) => `${c.kind}:${c.ref}`;

/**
 * Append a page, dropping rows already listed. Offset paging can repeat a row
 * when something is published between two page loads (everything shifts down
 * by one); a duplicate would also duplicate a React key and a listbox option.
 */
export function appendCandidates(prev: EmbedCandidate[], next: EmbedCandidate[]): EmbedCandidate[] {
  if (next.length === 0) return prev;
  const seen = new Set(prev.map(candidateKey));
  const out = prev.slice();
  for (const c of next) {
    const key = candidateKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

// ── list state ───────────────────────────────────────────────────────────────

export interface PickerListState {
  /** The request this state is waiting for (or last accepted). */
  reqId: number;
  items: EmbedCandidate[];
  nextCursor: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** At least one page arrived for the current query. */
  loaded: boolean;
  /** The last page said the server's offset cap — not the data — ended the stream. */
  truncated: boolean;
}

export const INITIAL_PICKER_LIST: PickerListState = { reqId: 0, items: [], nextCursor: null, status: 'idle', loaded: false, truncated: false };

export type PickerListAction =
  | { type: 'reset'; reqId: number }
  | { type: 'more'; reqId: number }
  | { type: 'page'; reqId: number; items: EmbedCandidate[]; nextCursor: string | null; truncated?: boolean }
  | { type: 'error'; reqId: number };

export function pickerListReducer(state: PickerListState, action: PickerListAction): PickerListState {
  switch (action.type) {
    case 'reset':
      return { reqId: action.reqId, items: [], nextCursor: null, status: 'loading', loaded: false, truncated: false };
    case 'more':
      // Single flight, and only while there IS a next page (a retry after a
      // failed page keeps its cursor, so `error` may continue too).
      if (state.status === 'loading' || state.status === 'idle' || !state.nextCursor) return state;
      return { ...state, reqId: action.reqId, status: 'loading' };
    case 'page':
      if (action.reqId !== state.reqId || state.status !== 'loading') return state;
      return {
        reqId: state.reqId,
        items: appendCandidates(state.items, action.items),
        nextCursor: action.nextCursor,
        status: 'ready',
        loaded: true,
        truncated: action.truncated === true,
      };
    case 'error':
      if (action.reqId !== state.reqId || state.status !== 'loading') return state;
      return { ...state, status: 'error' };
  }
}

/** The sentinel / keyboard may fetch on their own only from a settled list — never in a loop after a failure. */
export function canAutoLoadMore(state: PickerListState): boolean {
  return state.status === 'ready' && !!state.nextCursor;
}

/** 已经到底了: the stream ended and showed something (an empty result has its own message). */
export function isPickerListEnd(state: PickerListState): boolean {
  return settledEnd(state) && !state.truncated;
}

/**
 * The stream stopped at the server's offset cap with rows still unreachable
 * (最热 only — 最新 pages by keyset). Saying 已经到底了 here would be a lie, so
 * the dialog asks for a keyword instead.
 */
export function isPickerListCapped(state: PickerListState): boolean {
  return settledEnd(state) && state.truncated;
}

function settledEnd(state: PickerListState): boolean {
  return state.status === 'ready' && state.loaded && state.nextCursor === null && state.items.length > 0;
}

/**
 * The rows on screen do not answer what is in the search box yet: the debounce
 * has not fired, or the first page of the new keyword is still loading. Enter
 * must not pick a row in that window — it would insert something from the
 * PREVIOUS query and close the dialog, which a fast typist never sees. (↑/↓
 * over stale rows insert nothing, so only Enter needs the gate; a load-more
 * page, where rows are already on screen, is not stale.)
 */
export function searchResultsArePending(q: string, debouncedQ: string, state: PickerListState): boolean {
  return q.trim() !== debouncedQ || (state.status === 'loading' && state.items.length === 0);
}

/** Rows from the end at which keyboard navigation starts the next page (the sentinel covers pointers). */
export const KEYBOARD_PREFETCH_ROWS = 3;

export function shouldPrefetchForActive(active: number, count: number): boolean {
  return count > 0 && active >= count - KEYBOARD_PREFETCH_ROWS;
}

/**
 * The scope to query for a kind: a scope the kind does not offer (合集包 has no
 * 我发布的) falls back to 全部, so switching tabs never sends a request the
 * route would 400.
 */
export function effectiveScope(offered: readonly EmbedSearchScope[], wanted: EmbedSearchScope): EmbedSearchScope {
  return offered.includes(wanted) ? wanted : 'all';
}

// ── labels ───────────────────────────────────────────────────────────────────

/**
 * 我的收藏 wears the destination's OWN name — members save a doc with 加入书架,
 * a video with 稍后看 and an event with 我要参加, so that is the word they look
 * for. Keys live in the `zones` namespace.
 */
export function favScopeLabelKey(kind: SearchableEmbedKind): string {
  switch (kind) {
    case 'library':
      return 'embed_scope_fav_library';
    case 'video':
    case 'short':
      return 'embed_scope_fav_video';
    case 'event':
      return 'embed_scope_fav_event';
    default:
      return 'embed_scope_fav';
  }
}

export function favBadgeLabelKey(kind: SearchableEmbedKind): string {
  switch (kind) {
    case 'library':
      return 'embed_badge_fav_library';
    case 'video':
    case 'short':
      return 'embed_badge_fav_video';
    case 'event':
      return 'embed_badge_fav_event';
    default:
      return 'embed_badge_fav';
  }
}

export function scopeLabelKey(kind: SearchableEmbedKind, scope: EmbedSearchScope): string {
  if (scope === 'fav') return favScopeLabelKey(kind);
  return scope === 'mine' ? 'embed_scope_mine' : 'embed_scope_all';
}
