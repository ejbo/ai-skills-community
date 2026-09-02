'use client';

// 插入引用 picker for the editor: one tab per embed kind. Searchable kinds
// query GET /api/zones/embed/search?kind&q (server-gated candidates); 附件
// lists the post's saved attachments AND the composer's unsaved drafts (a
// `file` ref may be a storage key, so nothing has to be saved first) with an
// 上传 entry that opens the editor's own file input; 链接 is a plain URL input.
// Rows are a keyboard listbox (useListboxNav) with a SPRING_SNAPPY highlight.
// Portaled to <body> (the editor root is overflow-hidden) above the drawer,
// below Toaster.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Link2, Loader2, Search, Upload, X } from 'lucide-react';
import { TabBar } from '@/components/motion';
import { withBasePath } from '@/lib/base-path';
import { SPRING_SNAPPY } from '@/lib/motion';
import { EMBED_KINDS, normalizeHttpUrl, type EmbedKind } from '@/lib/zones/shared';
import type { EmbedCandidate, ZoneAttachmentView } from '@/lib/zones/types';
import { EMBED_KIND_ICONS, embedKindLabelKey } from './EmbedCard';
import { attachmentIconFor } from '@/components/zones/attachments/AttachmentCard';
import { draftToView, type AttachmentDraft } from '@/components/zones/attachments/upload-core';
import { useListboxNav } from '@/components/zones/useListboxNav';

const SEARCHABLE: readonly EmbedKind[] = ['library', 'short', 'video', 'skill', 'pack', 'event', 'post'];

interface FileRow {
  /** `id` for a saved row, else the storage key. */
  ref: string;
  view: ZoneAttachmentView;
  unsaved: boolean;
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
  const reduce = useReducedMotion();
  const [tab, setTab] = useState<EmbedKind>(() => kinds[0] ?? 'library');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<EmbedCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [linkDraft, setLinkDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
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

  const searchable = SEARCHABLE.includes(tab);

  useEffect(() => {
    if (!open || !searchable) return;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      fetch(`/api/zones/embed/search?kind=${encodeURIComponent(tab)}&q=${encodeURIComponent(q.trim())}`)
        .then(async (res) => {
          if (cancelled) return;
          const data = (await res.json().catch(() => null)) as { items?: EmbedCandidate[] } | null;
          setItems(res.ok && Array.isArray(data?.items) ? data.items : []);
        })
        .catch(() => {
          if (!cancelled) setItems([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, tab, q, searchable]);

  // 附件 rows: saved first (by id), then the unsaved drafts (by key). A draft
  // that already has an id is the same row as a saved attachment — skipped.
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
  const rowCount = searchable ? items.length : tab === 'file' ? fileRows.length : 0;
  const nav = useListboxNav(rowCount, (i) => {
    if (searchable) {
      const c = items[i];
      if (c) pick(c.kind, c.ref);
    } else if (tab === 'file') {
      const r = fileRows[i];
      if (r) pick('file', r.ref);
    }
  });
  const { setActive } = nav;
  // A new tab or a new result set starts at the top.
  useEffect(() => setActive(0), [tab, q, setActive]);

  if (!open || !mounted) return null;

  const rowCls =
    'relative flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left outline-none transition-colors';
  const KindIcon = EMBED_KIND_ICONS[tab];
  const spring = reduce ? { duration: 0 } : SPRING_SNAPPY;
  const highlight = (
    <motion.span layoutId="opt-pill" aria-hidden transition={spring} className="absolute inset-0 rounded-lg bg-zinc-100 dark:bg-zinc-800/70" />
  );

  const listProps = {
    ref: nav.listRef,
    role: 'listbox' as const,
    'aria-activedescendant': nav.activeId,
    className: 'mt-2 space-y-0.5',
  };

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-zinc-900/30 p-0 sm:items-center sm:p-6 dark:bg-black/60" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('embed_picker_title')}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={nav.onKeyDown}
        className="flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-zinc-200 bg-white shadow-2xl sm:rounded-2xl dark:border-zinc-800 dark:bg-zinc-950"
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
        <div className="overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabBar id="embed-picker" ariaLabel={t('embed_picker_title')} tabs={tabs} active={tab} onSelect={(key) => setTab(key as EmbedKind)} className="min-w-max" />
        </div>

        <LayoutGroup id="embed-picker-rows">
          <div className="min-h-0 flex-1 overflow-y-auto p-3 scroll-thin">
            {searchable && (
              <>
                <label className="flex h-9 items-center gap-2 rounded-lg border border-zinc-200 px-3 dark:border-zinc-800">
                  <Search className="h-4 w-4 shrink-0 text-muted" />
                  <input
                    ref={inputRef}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    role="combobox"
                    aria-expanded
                    aria-activedescendant={nav.activeId}
                    aria-autocomplete="list"
                    placeholder={t('embed_search_placeholder', { kind: t(embedKindLabelKey(tab)) })}
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
                  />
                  {loading && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
                </label>
                <ul {...listProps}>
                  {items.map((c, i) => (
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
                          <span className="block truncate text-sm font-medium">{c.title}</span>
                          {c.subtitle && <span className="block truncate text-xs text-muted">{c.subtitle}</span>}
                        </span>
                        <span className="relative shrink-0 font-mono text-[11px] text-muted">{c.ref}</span>
                      </button>
                    </li>
                  ))}
                  {!loading && items.length === 0 && (
                    <li className="px-2 py-8 text-center text-sm text-muted">{q.trim() ? t('embed_search_empty') : t('embed_search_hint')}</li>
                  )}
                </ul>
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
                <ul {...listProps}>
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
