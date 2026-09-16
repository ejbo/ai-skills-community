'use client';

// 插入引用 picker for the editor: one tab per embed kind.
//
// Searchable kinds are a content BROWSER over GET /api/zones/embed/search
// (server-gated candidates, lib/zones/embeds.ts): a scope row 全部 / 我发布的 /
// 我的收藏 (only the scopes the kind has — EMBED_SEARCH_SCOPES_BY_KIND), a sort
// row 最新 / 最热, and an infinitely scrolling list, 20 rows a page: an
// IntersectionObserver sentinel below the list (rooted in the list's own
// scroller) fetches the next page, a 加载更多 button is the fallback, keyboard
// navigation near the end prefetches too, and 已经到底了 closes the stream —
// unless the server's offset cap ended it early (`truncated`, 最热 only), which
// asks for a keyword instead of claiming the list is complete.
// Rows lead with the TITLE, then publisher / zone, 我发布的 / 已收藏 / 已编辑
// badges and 「更新于 X」 — the inserted ref is never shown. The list state is a
// reducer keyed by request id (embed-picker-helpers.ts) so a slow page for an
// old keyword / scope can never land in the new list; typing is debounced, and
// Enter is inert until the list answers the box (it used to insert a row from
// the previous keyword, then close).
//
// 附件 lists the post's saved attachments AND the composer's unsaved drafts (a
// `file` ref may be a storage key, so nothing has to be saved first) with an
// 上传 entry that opens the editor's own file input; 链接 is a plain URL input.
// Rows are a keyboard listbox (useListboxNav) with a SPRING_SNAPPY highlight.
// Portaled to <body> (the editor root is overflow-hidden) above the drawer,
// below Toaster.

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { useLocale, useTranslations } from 'next-intl';
import { Bookmark, Link2, Loader2, RotateCw, Search, Upload, X } from 'lucide-react';
import { TabBar } from '@/components/motion';
import { withBasePath } from '@/lib/base-path';
import { relativeTime } from '@/lib/i18n-date';
import { SPRING_SNAPPY } from '@/lib/motion';
import {
  EMBED_SEARCH_MAX_QUERY,
  EMBED_SEARCH_SORTS,
  isSearchableEmbedKind,
  scopesForKind,
  type EmbedSearchScope,
  type EmbedSearchSort,
  type SearchableEmbedKind,
} from '@/lib/zones/embed-search-shared';
import { EMBED_KINDS, normalizeHttpUrl, type EmbedKind } from '@/lib/zones/shared';
import type { EmbedCandidate, ZoneAttachmentView } from '@/lib/zones/types';
import { EMBED_KIND_ICONS, embedKindLabelKey } from './EmbedCard';
import {
  INITIAL_PICKER_LIST,
  canAutoLoadMore,
  effectiveScope,
  embedSearchUrl,
  favBadgeLabelKey,
  isPickerListCapped,
  isPickerListEnd,
  parseEmbedSearchPage,
  pickerListReducer,
  scopeLabelKey,
  searchResultsArePending,
  shouldPrefetchForActive,
  type PickerListState,
} from './embed-picker-helpers';
import { attachmentIconFor } from '@/components/zones/attachments/AttachmentCard';
import { draftToView, type AttachmentDraft } from '@/components/zones/attachments/upload-core';
import { useListboxNav } from '@/components/zones/useListboxNav';

const SEARCH_DEBOUNCE_MS = 250;
/** Start the next page this far before the sentinel scrolls into view. */
const SENTINEL_MARGIN_PX = 240;

interface FileRow {
  /** `id` for a saved row, else the storage key. */
  ref: string;
  view: ZoneAttachmentView;
  unsaved: boolean;
}

const chipCls = (active: boolean) =>
  `inline-flex h-7 shrink-0 items-center rounded-full border px-2.5 text-xs font-medium transition ${
    active
      ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900'
      : 'border-zinc-200 text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:text-zinc-100'
  }`;

function RowBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-zinc-300 px-1.5 py-px text-[10px] font-medium leading-4 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
      {children}
    </span>
  );
}

export function EmbedPickerDialog({
  open,
  onClose,
  kinds = EMBED_KINDS,
  attachments = [],
  drafts = [],
  onUpload,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  /** Tabs to offer. 讨论区 drops `file` (it has no attachment rows). */
  kinds?: readonly EmbedKind[];
  /** Saved attachment rows of the post being edited. */
  attachments?: ZoneAttachmentView[];
  /** Composer drafts; the unsaved ones (id null) are listed by storage key. */
  drafts?: AttachmentDraft[];
  /** Opens the editor's file input (the 附件 tab is a second entry point, not a dead end). */
  onUpload?: () => void;
  onPick: (kind: EmbedKind, ref: string) => void;
}) {
  const t = useTranslations('zones');
  const tc = useTranslations('common');
  const locale = useLocale();
  const reduce = useReducedMotion();
  const [tab, setTab] = useState<EmbedKind>(() => kinds[0] ?? 'library');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [scope, setScope] = useState<EmbedSearchScope>('all');
  const [sort, setSort] = useState<EmbedSearchSort>('new');
  const [list, dispatch] = useReducer(pickerListReducer, INITIAL_PICKER_LIST);
  const [linkDraft, setLinkDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const tabStripRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = setTimeout(() => inputRef.current?.focus(), 30);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      clearTimeout(timer);
    };
  }, [open, onClose]);

  // Nine tabs overflow a phone: keep the selected one in view (horizontally
  // only — scrollIntoView would also move the sheet).
  useEffect(() => {
    const strip = tabStripRef.current;
    const el = strip?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!open || !strip || !el) return;
    const s = strip.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.left < s.left) strip.scrollLeft -= s.left - r.left + 16;
    else if (r.right > s.right) strip.scrollLeft += r.right - s.right + 16;
  }, [open, mounted, tab]);

  const searchKind: SearchableEmbedKind | null = isSearchableEmbedKind(tab) ? tab : null;
  const offeredScopes = useMemo(() => (searchKind ? scopesForKind(searchKind) : (['all'] as const)), [searchKind]);
  // A scope the kind lacks (合集包 has no 我发布的) reads as 全部 without forgetting
  // the choice — tabbing back to 知识库 restores 我的书架.
  const activeScope = effectiveScope(offeredScopes, scope);

  // Clearing the box answers at once; typing waits for a pause.
  useEffect(() => {
    const next = q.trim();
    const timer = setTimeout(() => setDebouncedQ(next), next ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [q]);

  // ── paging ─────────────────────────────────────────────────────────────────
  // `listStateRef` mirrors the reducer state synchronously: the sentinel observer
  // and the keyboard prefetch can both ask for the same page in one tick, before
  // React has re-rendered the `loading` status.
  const listStateRef = useRef<PickerListState>(list);
  listStateRef.current = list;
  const reqSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const request = useCallback(async (url: string, reqId: number) => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      const page = res.ok ? parseEmbedSearchPage(await res.json().catch(() => null)) : null;
      if (page) dispatch({ type: 'page', reqId, items: page.items, nextCursor: page.nextCursor, truncated: page.truncated });
      else dispatch({ type: 'error', reqId });
    } catch {
      if (!ctrl.signal.aborted) dispatch({ type: 'error', reqId });
    }
  }, []);

  const loadFirstPage = useCallback(() => {
    if (!searchKind) return;
    abortRef.current?.abort();
    const reqId = ++reqSeq.current;
    dispatch({ type: 'reset', reqId });
    listStateRef.current = { reqId, items: [], nextCursor: null, status: 'loading', loaded: false, truncated: false };
    scrollerRef.current?.scrollTo({ top: 0 });
    void request(embedSearchUrl({ kind: searchKind, q: debouncedQ, scope: activeScope, sort, cursor: null }), reqId);
  }, [searchKind, debouncedQ, activeScope, sort, request]);

  const loadMore = useCallback(
    (manual: boolean) => {
      const s = listStateRef.current;
      if (!searchKind || !s.nextCursor) return;
      if (manual ? s.status === 'loading' : !canAutoLoadMore(s)) return;
      const reqId = ++reqSeq.current;
      dispatch({ type: 'more', reqId });
      listStateRef.current = { ...s, reqId, status: 'loading' };
      void request(embedSearchUrl({ kind: searchKind, q: debouncedQ, scope: activeScope, sort, cursor: s.nextCursor }), reqId);
    },
    [searchKind, debouncedQ, activeScope, sort, request],
  );

  // A new kind / scope / sort / keyword (or reopening) starts over.
  useEffect(() => {
    if (!open || !searchKind) return;
    loadFirstPage();
  }, [open, searchKind, loadFirstPage]);

  useEffect(() => {
    if (!open) abortRef.current?.abort();
    return () => abortRef.current?.abort();
  }, [open]);

  const retry = () => {
    if (listStateRef.current.loaded) loadMore(true);
    else loadFirstPage();
  };

  // ── 附件 ───────────────────────────────────────────────────────────────────
  // Saved first (by id), then the unsaved drafts (by key). A draft that already
  // has an id is the same row as a saved attachment — skipped.
  const fileRows = useMemo<FileRow[]>(() => {
    const rows: FileRow[] = attachments.filter((a) => a.id).map((a) => ({ ref: a.id, view: a, unsaved: false }));
    for (const d of drafts) {
      if (d.id) continue;
      rows.push({ ref: d.key, view: draftToView(d), unsaved: true });
    }
    return rows;
  }, [attachments, drafts]);

  const tabs = useMemo(
    () => kinds.map((k) => ({ key: k, label: t(embedKindLabelKey(k)), count: k === 'file' ? fileRows.length : undefined })),
    [t, kinds, fileRows.length],
  );

  const linkUrl = normalizeHttpUrl(linkDraft);

  function pick(kind: EmbedKind, ref: string) {
    onPick(kind, ref);
    onClose();
  }

  // ONE listbox per visible tab: search results, or the 附件 rows. The 链接 tab
  // has no rows, so Enter there still submits its form.
  const items = list.items;
  const rowCount = searchKind ? items.length : tab === 'file' ? fileRows.length : 0;
  const nav = useListboxNav(rowCount, (i) => {
    if (searchKind) {
      const c = items[i];
      if (c) pick(c.kind, c.ref);
    } else if (tab === 'file') {
      const r = fileRows[i];
      if (r) pick('file', r.ref);
    }
  });
  const { setActive, active } = nav;
  // A new tab or a new result set starts at the top.
  useEffect(() => setActive(0), [tab, debouncedQ, activeScope, sort, setActive]);

  // Keyboard users reach the end without scrolling the sentinel into view first.
  useEffect(() => {
    if (searchKind && shouldPrefetchForActive(active, items.length)) loadMore(false);
  }, [active, items.length, searchKind, loadMore]);

  // The sentinel observer is rebuilt after every page: if the new page still
  // leaves the sentinel inside the margin (a tall sheet, short rows), observe()
  // reports it intersecting immediately and the next page follows.
  useEffect(() => {
    const root = scrollerRef.current;
    const target = sentinelRef.current;
    if (!open || !searchKind || !root || !target || list.status !== 'ready' || !list.nextCursor) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && loadMore(false), {
      root,
      rootMargin: `0px 0px ${SENTINEL_MARGIN_PX}px 0px`,
    });
    io.observe(target);
    return () => io.disconnect();
  }, [open, searchKind, list.status, list.nextCursor, items.length, loadMore]);

  // The listbox keys are bound to the DIALOG (so ↑/↓ work wherever focus sits),
  // but the dialog also holds ordinary controls: 关闭, the tabs, the scope/sort
  // chips, 加载更多, 上传文件, 插入. Enter must activate the FOCUSED control — routed
  // to the listbox it inserted the highlighted row and closed the dialog instead
  // (and `preventDefault` swallowed the button's own click).
  // While the typed keyword has not reached the server, the rows on screen are
  // still the PREVIOUS query's — Enter would insert one of THOSE and close the
  // dialog, so it is swallowed until the list answers the box.
  const resultsPending = !!searchKind && searchResultsArePending(q, debouncedQ, list);
  const onDialogKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' && e.target instanceof Element && e.target.closest('button,[role="tab"],a[href]')) return;
    if (e.key === 'Enter' && resultsPending && !e.nativeEvent.isComposing) {
      e.preventDefault();
      return;
    }
    nav.onKeyDown(e);
  };

  if (!open || !mounted) return null;

  const rowCls = 'relative flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left outline-none transition-colors';
  const KindIcon = EMBED_KIND_ICONS[tab];
  const spring = reduce ? { duration: 0 } : SPRING_SNAPPY;
  const highlight = (
    <motion.span layoutId="opt-pill" aria-hidden transition={spring} className="absolute inset-0 rounded-lg bg-zinc-100 dark:bg-zinc-800/70" />
  );

  const listProps = {
    ref: nav.listRef,
    role: 'listbox' as const,
    'aria-activedescendant': nav.activeId,
    'aria-busy': searchKind ? list.status === 'loading' : undefined,
    className: 'space-y-0.5',
  };

  const kindLabel = t(embedKindLabelKey(tab));
  const typing = q.trim() !== debouncedQ;
  const firstLoading = list.status === 'loading' && items.length === 0;

  let emptyText = '';
  if (searchKind && list.status === 'ready' && items.length === 0) {
    if (debouncedQ) emptyText = t('embed_search_empty');
    else if (activeScope === 'mine') emptyText = t('embed_empty_mine', { kind: kindLabel });
    else if (activeScope === 'fav') emptyText = t('embed_empty_fav', { scope: t(scopeLabelKey(searchKind, 'fav')), kind: kindLabel });
    else emptyText = t('embed_empty_all', { kind: kindLabel });
  }

  const footerBtn =
    'inline-flex h-8 items-center gap-1.5 rounded-full border border-zinc-200 px-3 text-xs font-medium text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:text-zinc-50';

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-zinc-900/30 p-0 sm:items-center sm:p-6 dark:bg-black/60" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('embed_picker_title')}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onDialogKeyDown}
        // Searchable tabs get a FIXED height so pages arriving (or a scope with
        // three rows) never resize the sheet under the pointer.
        className={`flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-zinc-200 bg-white shadow-2xl sm:rounded-2xl dark:border-zinc-800 dark:bg-zinc-950 ${
          searchKind ? 'h-[min(680px,88dvh)]' : ''
        }`}
      >
        <div className="flex items-center justify-between gap-3 px-4 pt-3">
          <h2 className="text-sm font-semibold">{t('embed_picker_title')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={tc('dismiss')}
            className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div ref={tabStripRef} className="overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabBar id="embed-picker" ariaLabel={t('embed_picker_title')} tabs={tabs} active={tab} onSelect={(key) => setTab(key as EmbedKind)} className="min-w-max" />
        </div>

        {searchKind && (
          // Search + scope + sort stay put while only the list scrolls; the
          // hairline is where scrolled rows disappear.
          <div className="space-y-2 border-b border-zinc-100 px-3 pb-3 pt-3 dark:border-zinc-800/70">
            <label className="flex h-9 items-center gap-2 rounded-lg border border-zinc-200 px-3 dark:border-zinc-800">
              <Search className="h-4 w-4 shrink-0 text-muted" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                maxLength={EMBED_SEARCH_MAX_QUERY}
                role="combobox"
                aria-expanded
                aria-activedescendant={nav.activeId}
                aria-autocomplete="list"
                placeholder={t('embed_search_placeholder', { kind: kindLabel })}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
              />
              {(typing || firstLoading) && <Loader2 className="h-4 w-4 animate-spin text-muted" aria-hidden />}
            </label>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {offeredScopes.length > 1 && (
                <div role="group" aria-label={t('embed_scope_label')} className="flex min-w-0 flex-wrap items-center gap-1.5">
                  {offeredScopes.map((s) => (
                    <button key={s} type="button" aria-pressed={activeScope === s} onClick={() => setScope(s)} className={chipCls(activeScope === s)}>
                      {t(scopeLabelKey(searchKind, s))}
                    </button>
                  ))}
                </div>
              )}
              <div role="group" aria-label={t('embed_sort_label')} className="ml-auto flex items-center gap-1.5">
                {EMBED_SEARCH_SORTS.map((s) => (
                  <button key={s} type="button" aria-pressed={sort === s} onClick={() => setSort(s)} className={chipCls(sort === s)}>
                    {s === 'hot' ? t('embed_sort_hot') : t('embed_sort_new')}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <LayoutGroup id="embed-picker-rows">
          <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 scroll-thin">
            {searchKind && (
              <>
                <ul {...listProps}>
                  {items.map((c: EmbedCandidate, i) => (
                    <li key={`${c.kind}:${c.ref}`} id={nav.optionId(i)} data-index={i} role="option" aria-selected={nav.active === i}>
                      <button type="button" tabIndex={-1} className={rowCls} onPointerEnter={() => setActive(i)} onClick={() => pick(c.kind, c.ref)}>
                        {nav.active === i && highlight}
                        {c.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={withBasePath(c.imageUrl)} alt="" loading="lazy" className="relative h-10 w-14 shrink-0 rounded-md bg-zinc-100 object-cover dark:bg-zinc-900" />
                        ) : (
                          <span className="relative flex h-10 w-14 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                            <KindIcon className="h-4 w-4" />
                          </span>
                        )}
                        <span className="relative min-w-0 flex-1">
                          <span className="flex items-baseline gap-3">
                            <span className="min-w-0 flex-1 truncate text-sm font-medium" title={c.title || undefined}>
                              {c.title || t('embed_untitled')}
                            </span>
                            <time dateTime={c.updatedAt} className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-muted">
                              {t('embed_updated', { time: relativeTime(c.updatedAt, locale) })}
                            </time>
                          </span>
                          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted">
                            {c.mine && <RowBadge>{t('embed_badge_mine')}</RowBadge>}
                            {c.favorited && (
                              <RowBadge>
                                <Bookmark className="h-2.5 w-2.5" aria-hidden />
                                {t(favBadgeLabelKey(searchKind))}
                              </RowBadge>
                            )}
                            {/* The time above is the PUBLISH instant (what 最新 sorts by); a later edit says so here. */}
                            {c.edited && <RowBadge>{t('embed_badge_edited')}</RowBadge>}
                            {c.subtitle && <span className="min-w-0 truncate">{c.subtitle}</span>}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>

                {firstLoading && (
                  <p className="flex items-center justify-center gap-2 px-2 py-10 text-sm text-muted" role="status">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    {t('embed_loading')}
                  </p>
                )}
                {emptyText && <p className="px-2 py-10 text-center text-sm text-muted">{emptyText}</p>}

                {/* Sentinel + footer: the observer watches the sentinel; the button is the no-IO fallback. */}
                <div ref={sentinelRef} aria-hidden className="h-px" />
                {items.length > 0 && (
                  <div className="flex min-h-10 items-center justify-center py-2 text-xs text-muted" role="status">
                    {list.status === 'loading' && (
                      <span className="inline-flex items-center gap-1.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        {t('embed_loading')}
                      </span>
                    )}
                    {list.status === 'ready' && list.nextCursor && (
                      <button type="button" onClick={() => loadMore(true)} className={footerBtn}>
                        {t('embed_load_more')}
                      </button>
                    )}
                    {isPickerListEnd(list) && <span>{t('embed_list_end')}</span>}
                    {/* The cap, not the data, ended the stream — never claim the list is complete. */}
                    {isPickerListCapped(list) && <span className="px-2 text-center">{t('embed_list_capped')}</span>}
                  </div>
                )}
                {list.status === 'error' && (
                  <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-sm text-muted" role="alert">
                    <span>{t('embed_load_failed')}</span>
                    <button type="button" onClick={retry} className={footerBtn}>
                      <RotateCw className="h-3.5 w-3.5" aria-hidden />
                      {t('embed_retry')}
                    </button>
                  </div>
                )}
              </>
            )}

            {tab === 'file' && (
              <>
                {onUpload && (
                  <button
                    type="button"
                    onClick={() => {
                      // Close first so the placeholders land in view; the input click
                      // must stay inside this user gesture.
                      onClose();
                      onUpload();
                    }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs font-medium text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:text-zinc-50"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    {t('embed_attach_upload')}
                  </button>
                )}
                <ul {...listProps} className="mt-2 space-y-0.5">
                  {fileRows.map((row, i) => {
                    const a = row.view;
                    const Icon = attachmentIconFor(a);
                    return (
                      <li key={row.ref} id={nav.optionId(i)} data-index={i} role="option" aria-selected={nav.active === i}>
                        <button type="button" tabIndex={-1} className={rowCls} onPointerEnter={() => setActive(i)} onClick={() => pick('file', row.ref)}>
                          {nav.active === i && highlight}
                          {a.kind === 'image' ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={withBasePath(a.url)} alt="" loading="lazy" className="relative h-10 w-14 shrink-0 rounded-md bg-zinc-100 object-cover dark:bg-zinc-900" />
                          ) : (
                            <span className="relative flex h-10 w-14 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                              <Icon className="h-4 w-4" />
                            </span>
                          )}
                          <span className="relative min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium">{a.name}</span>
                              {row.unsaved && (
                                <span className="shrink-0 rounded-full border border-dashed border-zinc-400 px-1.5 py-px font-mono text-[10px] uppercase tracking-wide text-muted dark:border-zinc-600">
                                  {t('embed_attach_unsaved')}
                                </span>
                              )}
                            </span>
                            <span className="block truncate font-mono text-[11px] text-muted">{(a.ext || a.mimeType).toUpperCase()}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                  {fileRows.length === 0 && <li className="px-2 py-8 text-center text-sm text-muted">{t('embed_attach_none')}</li>}
                </ul>
              </>
            )}

            {tab === 'link' && (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (linkUrl) pick('link', linkUrl);
                }}
              >
                <label className="flex h-9 items-center gap-2 rounded-lg border border-zinc-200 px-3 dark:border-zinc-800">
                  <Link2 className="h-4 w-4 shrink-0 text-muted" />
                  <input
                    ref={inputRef}
                    value={linkDraft}
                    onChange={(e) => setLinkDraft(e.target.value)}
                    placeholder="https://"
                    inputMode="url"
                    className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-muted"
                  />
                </label>
                <p className="text-xs text-muted">{linkDraft.trim() && !linkUrl ? t('embed_link_invalid') : t('embed_link_hint')}</p>
                <button
                  type="submit"
                  disabled={!linkUrl}
                  className="inline-flex h-9 items-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  {t('embed_insert')}
                </button>
              </form>
            )}
          </div>
        </LayoutGroup>
      </div>
    </div>,
    document.body,
  );
}
