'use client';

// 表情包 picker panel (WeChat-style), opened from the rich-text editor toolbar.
// Portaled to <body> with fixed positioning near the anchor button — the editor
// root is overflow-hidden and may sit inside transformed (card-hover) ancestors,
// both of which would clip/trap an in-place absolute panel.
//
// Layout: header (title + 上传) / scrollable grid / bottom tab bar 最近·全部·收藏
// (bottom per the WeChat convention). Hovering a cell opens an enlarged preview
// card that also carries the per-sticker actions (红心收藏 / 删除) — bigger
// targets than corner icons on a 56px cell, same idea as WeChat's press menu.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Clock, Heart, LayoutGrid, Loader2, Plus, Trash2 } from 'lucide-react';
import { withBasePath } from '@/lib/base-path';
import { pushToast } from '@/components/Toaster';
import { currentLoginHref } from '@/lib/auth/callback-path';
import {
  MAX_STICKERS_PER_USER,
  RECENT_STICKERS_LIMIT,
  type StickerDto,
} from '@/lib/stickers';

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,image/gif';
const ACCEPTED_TYPES = new Set(IMAGE_ACCEPT.split(','));

const PANEL_W = 324;
const PANEL_H = 384;

type Tab = 'recent' | 'all' | 'fav';

function uploadErrorKey(code: string): string {
  switch (code) {
    case 'file_too_large':
      return 'err_file_too_large';
    case 'unsupported_type':
      return 'err_unsupported';
    case 'rate_limited':
      return 'err_rate_limited';
    case 'sticker_limit':
      return 'err_limit';
    default:
      return 'err_upload_failed';
  }
}

export function StickerPicker({
  open,
  anchor,
  onClose,
  onSelect,
}: {
  open: boolean;
  anchor: HTMLElement | null;
  onClose: () => void;
  onSelect: (sticker: StickerDto) => void;
}) {
  const t = useTranslations('stickers');
  const router = useRouter();
  const pathname = usePathname();

  const panelRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [stickers, setStickers] = useState<StickerDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [uploading, setUploading] = useState(0);

  // Hover preview (enlarged image + actions). Timers in refs, cleared on unmount.
  const [preview, setPreview] = useState<{ sticker: StickerDto; rect: DOMRect } | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimers = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  // Position near the anchor: below if there is room, else above; clamped to the
  // viewport. Recomputed each open (the page may have scrolled since last time).
  useEffect(() => {
    if (!open || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    let top = rect.bottom + 6;
    if (top + PANEL_H > window.innerHeight - 8) top = Math.max(8, rect.top - PANEL_H - 6);
    const left = Math.min(Math.max(8, rect.left - 8), window.innerWidth - PANEL_W - 8);
    setPos({ top, left });
  }, [open, anchor]);

  // Load the library each time the panel opens (cheap, always fresh).
  useEffect(() => {
    if (!open) {
      clearTimers(); // Escape/outside-click closes leave pending hover timers
      setPreview(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setNeedsLogin(false);
    fetch(withBasePath('/api/stickers'))
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          setNeedsLogin(true);
          return;
        }
        const data = (await res.json().catch(() => null)) as { stickers?: StickerDto[] } | null;
        setStickers(Array.isArray(data?.stickers) ? data.stickers : []);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, clearTimers]);

  // Dismissal: outside click + Escape + page scroll (fixed panel would drift).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      // The hover-preview card is portaled (a DOM sibling, not a child) — its
      // action buttons must not read as an outside click.
      if (previewRef.current?.contains(target)) return;
      if (anchor?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return; // grid's own scroll
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [open, anchor, onClose]);

  const goLogin = useCallback(() => {
    onClose();
    router.push(currentLoginHref());
  }, [onClose, router, pathname]);

  // ── Uploads: sequential raw-body POSTs, one file per request (house protocol).
  const onPickFiles = useCallback(() => fileInputRef.current?.click(), []);
  const onFilesChosen = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []).filter((f) => ACCEPTED_TYPES.has(f.type));
      e.target.value = ''; // allow re-picking the same file
      if (files.length === 0) return;
      const room = MAX_STICKERS_PER_USER - stickers.length;
      if (room <= 0) {
        pushToast('error', t('err_limit'));
        return;
      }
      const batch = files.slice(0, room);
      if (batch.length < files.length) pushToast('info', t('err_limit'));

      setUploading((n) => n + batch.length);
      let failed = 0;
      let firstError = '';
      for (const file of batch) {
        try {
          const res = await fetch(withBasePath('/api/stickers/upload'), {
            method: 'POST',
            headers: { 'content-type': file.type, 'x-filename': encodeURIComponent(file.name) },
            body: file,
          });
          if (res.status === 401) {
            setNeedsLogin(true);
            failed += 1;
          } else if (!res.ok) {
            const data = (await res.json().catch(() => null)) as { error?: string } | null;
            failed += 1;
            if (!firstError) firstError = typeof data?.error === 'string' ? data.error : '';
          } else {
            const data = (await res.json()) as { sticker: StickerDto };
            setStickers((prev) => [data.sticker, ...prev]);
          }
        } catch {
          failed += 1;
        } finally {
          setUploading((n) => n - 1);
        }
      }
      if (failed > 0) pushToast('error', t(uploadErrorKey(firstError)));
      else setTab('all');
    },
    [stickers.length, t],
  );

  // ── Per-sticker actions (optimistic, reconciled with the authoritative response).
  const favInflight = useRef(new Set<string>());
  const toggleFavorite = useCallback(
    async (sticker: StickerDto) => {
      // One in-flight toggle per sticker — a rapid double-click otherwise races
      // two PATCHes whose responses can land out of order.
      if (favInflight.current.has(sticker.id)) return;
      favInflight.current.add(sticker.id);
      const next = !sticker.favorited;
      const apply = (value: StickerDto | ((s: StickerDto) => StickerDto)) => {
        const patch = typeof value === 'function' ? value : () => value;
        setStickers((prev) => prev.map((s) => (s.id === sticker.id ? patch(s) : s)));
        setPreview((p) =>
          p && p.sticker.id === sticker.id ? { ...p, sticker: patch(p.sticker) } : p,
        );
      };
      apply((s) => ({ ...s, favorited: next }));
      try {
        const res = await fetch(withBasePath(`/api/stickers/${sticker.id}`), {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ favorited: next }),
        });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { sticker: StickerDto };
        apply(data.sticker); // server state wins
      } catch {
        apply((s) => ({ ...s, favorited: sticker.favorited }));
        pushToast('error', t('err_action_failed'));
      } finally {
        favInflight.current.delete(sticker.id);
      }
    },
    [t],
  );

  const removeSticker = useCallback(
    async (sticker: StickerDto) => {
      // Surgical revert on failure: re-insert just this row at its old index —
      // a whole-list snapshot would discard stickers uploaded meanwhile.
      const idx = stickers.findIndex((s) => s.id === sticker.id);
      setStickers((prev) => prev.filter((s) => s.id !== sticker.id));
      setPreview(null);
      try {
        const res = await fetch(withBasePath(`/api/stickers/${sticker.id}`), { method: 'DELETE' });
        if (!res.ok) throw new Error();
        pushToast('success', t('deleted'));
      } catch {
        setStickers((prev) => {
          if (prev.some((s) => s.id === sticker.id)) return prev;
          const next = [...prev];
          next.splice(Math.max(0, Math.min(idx, next.length)), 0, sticker);
          return next;
        });
        pushToast('error', t('err_action_failed'));
      }
    },
    [stickers, t],
  );

  const pick = useCallback(
    (sticker: StickerDto) => {
      onSelect(sticker);
      // Fire-and-forget 最近 bump; local state keeps the tab honest immediately.
      const usedAt = new Date().toISOString();
      setStickers((prev) => prev.map((s) => (s.id === sticker.id ? { ...s, lastUsedAt: usedAt } : s)));
      fetch(withBasePath(`/api/stickers/${sticker.id}`), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ used: true }),
      }).catch(() => undefined);
      clearTimers(); // a pending hover-open must not resurrect a preview later
      onClose();
    },
    [onSelect, onClose, clearTimers],
  );

  // ── Hover preview management (350ms open / 250ms grace, house timings).
  const cellEnter = useCallback(
    (sticker: StickerDto, el: HTMLElement) => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      if (openTimer.current) clearTimeout(openTimer.current);
      const rect = el.getBoundingClientRect();
      openTimer.current = setTimeout(() => setPreview({ sticker, rect }), 150);
    },
    [],
  );
  const scheduleClosePreview = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    closeTimer.current = setTimeout(() => setPreview(null), 250);
  }, []);
  const previewEnter = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  // ── Touch path: hover doesn't exist, so a ~450ms long-press on a cell opens
  // the same preview card (its 收藏/删除 buttons are the touch entry point);
  // a completed long-press must NOT also insert, hence the suppress ref.
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStart = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  const cellPointerDown = useCallback((sticker: StickerDto, e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    const el = e.currentTarget as HTMLElement;
    longPressStart.current = { x: e.clientX, y: e.clientY };
    longPressTimer.current = setTimeout(() => {
      suppressClickRef.current = true;
      setPreview({ sticker, rect: el.getBoundingClientRect() });
    }, 450);
  }, []);
  const cellPointerEnd = useCallback(() => {
    longPressStart.current = null;
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);
  // Cancel only on real movement (scroll intent) — touch jitter within 8px
  // must not kill the long-press.
  const cellPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const start = longPressStart.current;
      if (!start) return;
      if (Math.abs(e.clientX - start.x) > 8 || Math.abs(e.clientY - start.y) > 8) {
        cellPointerEnd();
      }
    },
    [cellPointerEnd],
  );
  useEffect(
    () => () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    },
    [],
  );

  if (!open || !pos) return null;

  const recent = stickers
    .filter((s) => s.lastUsedAt)
    .sort((a, b) => (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? ''))
    .slice(0, RECENT_STICKERS_LIMIT);
  const shown = tab === 'all' ? stickers : tab === 'fav' ? stickers.filter((s) => s.favorited) : recent;

  const emptyKey = tab === 'all' ? 'empty_all' : tab === 'fav' ? 'empty_fav' : 'empty_recent';

  const tabs: { id: Tab; icon: React.ReactNode; label: string }[] = [
    { id: 'recent', icon: <Clock className="h-4 w-4" />, label: t('tab_recent') },
    { id: 'all', icon: <LayoutGrid className="h-4 w-4" />, label: t('tab_all') },
    { id: 'fav', icon: <Heart className="h-4 w-4" />, label: t('tab_fav') },
  ];

  // Preview card geometry: centered above the cell, clamped to the viewport.
  const PREVIEW_W = 176;
  const previewLeft = preview
    ? Math.min(
        Math.max(8, preview.rect.left + preview.rect.width / 2 - PREVIEW_W / 2),
        window.innerWidth - PREVIEW_W - 8,
      )
    : 0;
  const previewAbove = preview ? preview.rect.top > 232 : true;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t('title')}
      className="surface fixed z-[100] flex flex-col overflow-hidden rounded-xl shadow-xl"
      style={{ top: pos.top, left: pos.left, width: PANEL_W, height: PANEL_H }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2 dark:border-zinc-800/60">
        <span className="text-sm font-medium">{t('title')}</span>
        <button
          type="button"
          onClick={onPickFiles}
          disabled={needsLogin || uploading > 0}
          className="flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium text-zinc-900 dark:text-zinc-50 transition hover:bg-zinc-900/10 dark:hover:bg-white/[0.14] disabled:opacity-40"
        >
          {uploading > 0 ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('uploading', { count: uploading })}
            </>
          ) : (
            <>
              <Plus className="h-3.5 w-3.5" />
              {t('upload')}
            </>
          )}
        </button>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {needsLogin ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-muted">{t('login_hint')}</p>
            <button
              type="button"
              onClick={goLogin}
              className="rounded-lg bg-zinc-900 dark:bg-zinc-100 px-3 py-1.5 text-sm font-medium text-white dark:text-zinc-900 transition hover:bg-zinc-700 dark:hover:bg-zinc-300"
            >
              {t('login')}
            </button>
          </div>
        ) : loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted" />
          </div>
        ) : shown.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <p className="text-sm text-muted">{t(emptyKey)}</p>
            {tab === 'all' && (
              <button
                type="button"
                onClick={onPickFiles}
                className="flex items-center gap-1 rounded-lg border border-zinc-900/40 dark:border-zinc-100/40 bg-zinc-900/[0.06] dark:bg-white/10 px-2.5 py-1 text-xs font-medium text-zinc-900 dark:text-zinc-50 transition hover:bg-zinc-900/10 dark:hover:bg-white/[0.14]"
              >
                <Plus className="h-3.5 w-3.5" />
                {t('upload')}
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-1">
            {shown.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false; // long-press opened the preview
                    return;
                  }
                  pick(s);
                }}
                onMouseEnter={(e) => cellEnter(s, e.currentTarget)}
                onMouseLeave={scheduleClosePreview}
                onPointerDown={(e) => cellPointerDown(s, e)}
                onPointerUp={cellPointerEnd}
                onPointerCancel={cellPointerEnd}
                onPointerMove={cellPointerMove}
                onContextMenu={(e) => e.preventDefault()}
                className="flex h-14 w-14 items-center justify-center rounded-lg p-1 transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={withBasePath(s.url)}
                  alt={t('sticker_alt')}
                  loading="lazy"
                  className="max-h-full max-w-full object-contain"
                  draggable={false}
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Bottom tab bar (最近 / 全部 / 收藏 — WeChat places categories below) */}
      <div className="flex items-center gap-1 border-t border-zinc-100 p-1.5 dark:border-zinc-800/60">
        {tabs.map(({ id, icon, label }) => (
          <button
            key={id}
            type="button"
            title={label}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
            className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition ${
              tab === id
                ? 'bg-zinc-900/[0.06] dark:bg-white/10 text-zinc-900 dark:text-zinc-50'
                : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
            }`}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        hidden
        onChange={onFilesChosen}
      />

      {/* Enlarged hover preview + actions (portaled sibling, fixed) */}
      {preview &&
        createPortal(
          <div
            ref={previewRef}
            className="surface fixed z-[110] flex flex-col items-center gap-2 rounded-xl p-3 shadow-xl"
            style={{
              width: PREVIEW_W,
              left: previewLeft,
              top: previewAbove ? preview.rect.top - 8 : preview.rect.bottom + 8,
              transform: previewAbove ? 'translateY(-100%)' : undefined,
            }}
            onMouseEnter={previewEnter}
            onMouseLeave={scheduleClosePreview}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={withBasePath(preview.sticker.url)}
              alt={t('sticker_alt')}
              className="h-32 w-32 object-contain"
              draggable={false}
            />
            <div className="flex w-full items-center justify-center gap-1">
              <button
                type="button"
                title={preview.sticker.favorited ? t('unfav') : t('fav')}
                aria-pressed={preview.sticker.favorited}
                onClick={() => toggleFavorite(preview.sticker)}
                className="flex h-8 flex-1 items-center justify-center rounded-lg transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <Heart
                  className={`h-4 w-4 ${
                    preview.sticker.favorited ? 'fill-danger text-danger' : 'text-zinc-500 dark:text-zinc-400'
                  }`}
                />
              </button>
              <button
                type="button"
                title={t('delete')}
                onClick={() => removeSticker(preview.sticker)}
                className="flex h-8 flex-1 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-danger dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>,
    document.body,
  );
}
