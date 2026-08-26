'use client';

// 插入引用 picker for the editor: one tab per embed kind. Searchable kinds
// query GET /api/zones/embed/search?kind&q (server-gated candidates); 附件
// lists the current post's SAVED attachments (file kind needs a row id — fresh
// uploads get one after 保存草稿); 链接 is a plain URL input. Portaled to
// <body> (the editor root is overflow-hidden) above the drawer, below Toaster.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Link2, Loader2, Search, X } from 'lucide-react';
import { TabBar } from '@/components/motion';
import { withBasePath } from '@/lib/base-path';
import { EMBED_KINDS, normalizeHttpUrl, type EmbedKind } from '@/lib/zones/shared';
import type { EmbedCandidate, ZoneAttachmentView } from '@/lib/zones/types';
import { EMBED_KIND_ICONS, embedKindLabelKey } from './EmbedCard';
import { attachmentIconFor } from '@/components/zones/attachments/AttachmentCard';

const SEARCHABLE: readonly EmbedKind[] = ['library', 'short', 'video', 'skill', 'pack', 'event', 'post'];

export function EmbedPickerDialog({
  open,
  onClose,
  zoneSlug,
  postAttachments = [],
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  zoneSlug: string;
  postAttachments?: ZoneAttachmentView[];
  onPick: (kind: EmbedKind, ref: string) => void;
}) {
  const t = useTranslations('zones');
  const tc = useTranslations('common');
  const [tab, setTab] = useState<EmbedKind>('library');
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
  }, [open, tab, q, searchable, zoneSlug]);

  const tabs = useMemo(
    () => EMBED_KINDS.map((k) => ({ key: k, label: t(embedKindLabelKey(k)), count: k === 'file' ? postAttachments.filter((a) => a.id).length : undefined })),
    [t, postAttachments],
  );

  const savedAttachments = postAttachments.filter((a) => a.id);
  const linkUrl = normalizeHttpUrl(linkDraft);

  function pick(kind: EmbedKind, ref: string) {
    onPick(kind, ref);
    onClose();
  }

  if (!open || !mounted) return null;

  const rowCls =
    'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:hover:bg-zinc-800';
  const KindIcon = EMBED_KIND_ICONS[tab];

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-zinc-900/30 p-0 sm:items-center sm:p-6 dark:bg-black/60" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('embed_picker_title')}
        onClick={(e) => e.stopPropagation()}
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

        <div className="min-h-0 flex-1 overflow-y-auto p-3 scroll-thin">
          {searchable && (
            <>
              <label className="flex h-9 items-center gap-2 rounded-lg border border-zinc-200 px-3 dark:border-zinc-800">
                <Search className="h-4 w-4 shrink-0 text-muted" />
                <input
                  ref={inputRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t('embed_search_placeholder', { kind: t(embedKindLabelKey(tab)) })}
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
                />
                {loading && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
              </label>
              <ul className="mt-2 space-y-0.5">
                {items.map((c) => (
                  <li key={`${c.kind}:${c.ref}`}>
                    <button type="button" className={rowCls} onClick={() => pick(c.kind, c.ref)}>
                      {c.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={withBasePath(c.imageUrl)} alt="" loading="lazy" className="h-10 w-14 shrink-0 rounded-md bg-zinc-100 object-cover dark:bg-zinc-900" />
                      ) : (
                        <span className="flex h-10 w-14 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                          <KindIcon className="h-4 w-4" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{c.title}</span>
                        {c.subtitle && <span className="block truncate text-xs text-muted">{c.subtitle}</span>}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-muted">{c.ref}</span>
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
            <ul className="space-y-0.5">
              {savedAttachments.map((a) => {
                const Icon = attachmentIconFor(a);
                return (
                  <li key={a.id}>
                    <button type="button" className={rowCls} onClick={() => pick('file', a.id)}>
                      {a.kind === 'image' ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={withBasePath(a.url)} alt="" loading="lazy" className="h-10 w-14 shrink-0 rounded-md bg-zinc-100 object-cover dark:bg-zinc-900" />
                      ) : (
                        <span className="flex h-10 w-14 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                          <Icon className="h-4 w-4" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{a.name}</span>
                        <span className="block truncate font-mono text-[11px] text-muted">{(a.ext || a.mimeType).toUpperCase()}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
              {savedAttachments.length === 0 && (
                <li className="px-2 py-8 text-center text-sm text-muted">
                  {postAttachments.length > 0 ? t('embed_attach_save_first') : t('embed_attach_empty')}
                </li>
              )}
            </ul>
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
      </div>
    </div>,
    document.body,
  );
}
