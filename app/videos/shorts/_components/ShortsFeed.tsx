'use client';

// 随刷短视频 — the immersive vertical swipe feed (TikTok/抖音-style).
//
// Load-bearing engineering choices (from the TikTok-web research pass):
// - CSS scroll-snap (`y mandatory` + per-cell `scroll-snap-stop: always`) does
//   the paging physics — no wheel interception, and a fast fling still stops on
//   every video. Cells are EXACTLY container height (100dvh; 100vh lies on iOS).
// - ONE IntersectionObserver picks the max-intersection cell as active — per-cell
//   "isVisible" booleans let two videos play at once mid-transition.
// - Only active ±2 cells mount a real <video> (each playable element costs
//   30-80 MB and mobile decoder pools are tiny); the rest render posters at the
//   same fixed height so the snap geometry never shifts.
// - Feed paging APPENDS only; the publish flow prepends + jumps to top as one
//   deliberate action (mandatory snap containers re-snap when content is
//   inserted before the active cell).
// - URL stays shareable via history.replaceState (?v=<id>) — replace, not push,
//   so Back exits the feed instead of replaying the scroll history.

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronLeft, Loader2, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { pushToast } from '@/components/Toaster';
import { HostPanel, PANEL_SCROLL_CLS } from './HostPanel';
import { ShortsAuthorWorks } from './ShortsAuthorWorks';
import { ShortsCell } from './ShortsCell';
import { ShortsCommentsDrawer } from './ShortsCommentsDrawer';
import { ShortsSidePanel, type PanelTab } from './ShortsSidePanel';
import { ShortsUploadDialog } from './ShortsUploadDialog';
import type { ShortsCellApi, ShortsCurrentUser, ShortView } from './types';

interface Props {
  initialItems: ShortView[];
  initialCursor: string | null;
  initialHasMore: boolean;
  sort: 'hot' | 'new';
  currentUser: ShortsCurrentUser;
  /**
   * ?focus=<commentId> notification deep link, resolved server-side: auto-open
   * the comment drawer on that item with this comment highlighted. Passed as a
   * prop (not read from the URL) because the feed's replaceState URL-sync
   * rewrites the query string before the drawer mounts.
   */
  initialFocus: { itemId: string; commentId: string } | null;
  /** ?comments=1 (embedded players' comment button) — open the drawer on the deep-linked item. */
  autoOpenComments: boolean;
  /** ?upload=1 entry link (homepage / strip 上传 buttons) — open the dialog on mount. */
  autoOpenUpload: boolean;
}

export function ShortsFeed({
  initialItems,
  initialCursor,
  initialHasMore,
  sort,
  currentUser,
  initialFocus,
  autoOpenComments,
  autoOpenUpload,
}: Props) {
  const t = useTranslations('shorts');
  const router = useRouter();

  const [items, setItems] = useState<ShortView[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(true);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [drawerFor, setDrawerFor] = useState<ShortView | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [hintVisible, setHintVisible] = useState(false);
  // Consumed on first drawer close so a later manual open doesn't re-highlight.
  const [pendingFocus, setPendingFocus] = useState(initialFocus);
  // Desktop right panel (抖音 layout): 详情 | 评论 follows the active video.
  const [panelTab, setPanelTab] = useState<PanelTab>(
    initialFocus || autoOpenComments ? 'comments' : 'info',
  );

  const [authorSheetFor, setAuthorSheetFor] = useState<ShortView | null>(null);

  // 评论 entry: desktop switches the side panel tab; mobile opens the sheet.
  function openComments(item: ShortView) {
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches) {
      setPanelTab('comments');
    } else {
      setDrawerFor(item);
    }
  }

  // 头像 → TA 的作品: desktop = side panel tab, mobile = bottom sheet.
  function openAuthor(item: ShortView) {
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches) {
      setPanelTab('works');
    } else {
      setAuthorSheetFor(item);
    }
  }

  // Works card click: jump in place when the short is already loaded, else
  // reload the feed at it (deep link keeps sort context).
  function jumpTo(target: ShortView) {
    setAuthorSheetFor(null);
    const i = items.findIndex((s) => s.id === target.id);
    if (i >= 0) go(i);
    else router.push(`/videos/shorts?v=${target.id}`);
  }

  const containerRef = useRef<HTMLDivElement | null>(null);
  const cellRefs = useRef<(HTMLDivElement | null)[]>([]);
  const cellApiRef = useRef<Map<number, ShortsCellApi>>(new Map());
  const ratiosRef = useRef<Map<number, number>>(new Map());
  const loadingRef = useRef(false);
  const activeRef = useRef(0);
  activeRef.current = active;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const reduceMotionRef = useRef(false);
  reduceMotionRef.current = reduceMotion;
  const overlayOpenRef = useRef(false);
  overlayOpenRef.current = drawerFor !== null || uploadOpen;

  const registerApi = useCallback((index: number, api: ShortsCellApi | null) => {
    if (api) cellApiRef.current.set(index, api);
    else cellApiRef.current.delete(index);
  }, []);

  // One-time client setup: persisted sound preference, first-visit hint,
  // reduced-motion media query, ?upload=1 entry.
  useEffect(() => {
    if (autoOpenUpload) setUploadOpen(true);
    try {
      if (localStorage.getItem('shorts:sound') === 'on') setMuted(false);
      if (!localStorage.getItem('shorts:hinted')) setHintVisible(true);
    } catch {
      /* storage unavailable */
    }
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduceMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const persistMuted = useCallback((next: boolean) => {
    setMuted(next);
    try {
      // The preference is "sound on/off", shared feed-wide and across sessions.
      localStorage.setItem('shorts:sound', next ? 'off' : 'on');
    } catch {
      /* storage unavailable */
    }
  }, []);

  // Active-cell detection: single observer, max intersection ratio wins.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const idx = Number((e.target as HTMLElement).dataset.index);
          if (Number.isFinite(idx)) {
            ratiosRef.current.set(idx, e.isIntersecting ? e.intersectionRatio : 0);
          }
        }
        let best = -1;
        let bestRatio = 0;
        ratiosRef.current.forEach((r, i) => {
          if (r > bestRatio) {
            bestRatio = r;
            best = i;
          }
        });
        if (best >= 0 && bestRatio >= 0.5 && best !== activeRef.current) setActive(best);
      },
      { root, threshold: [0.25, 0.5, 0.75, 0.98] },
    );
    cellRefs.current.slice(0, items.length).forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, [items.length]);

  // Dismiss the swipe hint after the first navigation.
  useEffect(() => {
    if (active > 0 && hintVisible) {
      setHintVisible(false);
      try {
        localStorage.setItem('shorts:hinted', '1');
      } catch {
        /* ignore */
      }
    }
  }, [active, hintVisible]);

  // Keep the address bar on the active video (share/refresh lands here).
  useEffect(() => {
    const item = items[active];
    if (!item) return;
    const sp = new URLSearchParams();
    sp.set('v', item.id);
    if (sort === 'new') sp.set('sort', 'new');
    window.history.replaceState(null, '', `${window.location.pathname}?${sp.toString()}`);
  }, [active, items, sort]);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore || !cursor) return;
    loadingRef.current = true;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/shorts?cursor=${encodeURIComponent(cursor)}&limit=8&sort=${sort}`,
      );
      if (!res.ok) throw new Error('failed');
      const data = await res.json();
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...(data.items as ShortView[]).filter((s) => !seen.has(s.id))];
      });
      setHasMore(Boolean(data.hasMore));
      setCursor(data.nextCursor ?? null);
    } catch {
      pushToast('error', t('load_failed'));
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, [cursor, hasMore, sort, t]);

  // Fetch the next page when the viewer nears the end of the loaded run.
  useEffect(() => {
    if (active >= items.length - 3) void loadMore();
  }, [active, items.length, loadMore]);

  const go = useCallback((index: number) => {
    const el = cellRefs.current[index];
    if (!el) return;
    el.scrollIntoView({ behavior: reduceMotionRef.current ? 'auto' : 'smooth', block: 'start' });
  }, []);

  // Keyboard: ↑/↓ navigate, Space play/pause, M mute, L like. Suspended while
  // typing (inputs, textareas, tiptap contenteditable) and during IME composition.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.isComposing) return;
      // Suspended while the comment drawer / upload dialog is open — Space and
      // arrows must not drive the video hidden behind an overlay.
      if (overlayOpenRef.current) return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) {
        return;
      }
      // A focused button/link owns Space/Enter activation.
      if (tgt?.closest?.('button, a, [role="dialog"]')) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        go(activeRef.current + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        go(activeRef.current - 1);
      } else if (e.key === ' ') {
        e.preventDefault();
        cellApiRef.current.get(activeRef.current)?.togglePlay();
      } else if (e.key === 'm' || e.key === 'M') {
        persistMuted(!mutedRef.current);
      } else if (e.key === 'l' || e.key === 'L') {
        cellApiRef.current.get(activeRef.current)?.toggleLike();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, persistMuted]);

  function onPublished(short: ShortView) {
    setUploadOpen(false);
    setItems((prev) => [short, ...prev.filter((p) => p.id !== short.id)]);
    // Deliberate jump to the new short at the top (insert-before-active is
    // otherwise forbidden in a mandatory snap container).
    containerRef.current?.scrollTo({ top: 0 });
    setActive(0);
    pushToast('success', t('publish_success'));
  }

  return (
    <div className="fixed inset-0 z-[60] flex bg-black text-white" style={{ height: '100dvh' }}>
      {/* LEFT — the swipe feed */}
      <div className="relative min-w-0 flex-1">
      <div
        ref={containerRef}
        role="feed"
        aria-label={t('feed_aria')}
        className="h-full snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item, i) => (
          <div
            key={item.id}
            data-index={i}
            ref={(el) => {
              cellRefs.current[i] = el;
            }}
            role="article"
            aria-posinset={i + 1}
            aria-setsize={items.length}
            aria-label={`${item.uploader.displayName}: ${item.title}`}
            className="relative h-full w-full snap-start"
            style={{ scrollSnapStop: 'always' }}
          >
            <ShortsCell
              item={item}
              index={i}
              active={i === active}
              nearActive={Math.abs(i - active) <= 2}
              muted={muted}
              reduceMotion={reduceMotion}
              onToggleMute={() => persistMuted(!muted)}
              onOpenComments={() => openComments(item)}
              onOpenAuthor={() => openAuthor(item)}
              registerApi={registerApi}
            />
          </div>
        ))}
        {items.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
            <p className="text-lg font-medium text-white/90">{t('empty_title')}</p>
            <p className="max-w-sm text-sm text-white/50">{t('empty_hint')}</p>
            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="mt-2 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-200 active:scale-95"
            >
              <Plus className="h-4 w-4" />
              {t('upload')}
            </button>
          </div>
        )}
      </div>

      {/* Top bar — 抖音-style: bare icons/text tabs on a soft gradient. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[9] bg-gradient-to-b from-black/60 to-transparent pb-12 pt-3">
        <div className="flex items-center gap-4 px-4">
          <Link
            href="/videos?tab=shorts"
            className="pointer-events-auto text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.7)] transition hover:scale-110 active:scale-90"
            aria-label={t('back')}
          >
            <ChevronLeft className="h-6 w-6" />
          </Link>
          <div className="pointer-events-auto flex items-center gap-5 text-[15px]">
            <SortPill href="/videos/shorts" label={t('sort_hot')} active={sort === 'hot'} />
            <SortPill href="/videos/shorts?sort=new" label={t('sort_new')} active={sort === 'new'} />
          </div>
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="pointer-events-auto ml-auto inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-zinc-900 shadow-lg transition hover:bg-zinc-200 active:scale-95"
          >
            <Plus className="h-4 w-4" />
            {t('upload')}
          </button>
        </div>
      </div>

      {/* First-visit swipe hint */}
      {hintVisible && items.length > 1 && (
        <div className="pointer-events-none absolute bottom-16 left-1/2 z-[9] -translate-x-1/2 text-white/80">
          <div className="flex flex-col items-center gap-1 text-xs">
            <ChevronDown className="h-6 w-6 animate-bounce" />
            {t('swipe_hint')}
          </div>
        </div>
      )}

      {loadingMore && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-[9] -translate-x-1/2">
          <Loader2 className="h-5 w-5 animate-spin text-white/70" />
        </div>
      )}

      {/* Mobile comment sheet (desktop uses the side panel instead) */}
      <AnimatePresence>
        {drawerFor && (
          <ShortsCommentsDrawer
            variant="sheet"
            short={drawerFor}
            currentUser={currentUser}
            focusCommentId={
              pendingFocus && pendingFocus.itemId === drawerFor.id ? pendingFocus.commentId : null
            }
            onClose={() => {
              if (pendingFocus && drawerFor.id === pendingFocus.itemId) setPendingFocus(null);
              setDrawerFor(null);
            }}
          />
        )}
      </AnimatePresence>

      {/* Mobile TA 的作品 sheet */}
      <AnimatePresence>
        {authorSheetFor && (
          <HostPanel
            variant="sheet"
            title={<span className="block truncate">{authorSheetFor.uploader.displayName}</span>}
            headerExtra={
              <Link
                href={`/users/${authorSheetFor.uploader.handle}`}
                className="text-xs font-medium text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                {t('author_profile')}
              </Link>
            }
            closeLabel={t('close')}
            onClose={() => setAuthorSheetFor(null)}
          >
            <div className={`${PANEL_SCROLL_CLS} px-4 py-4`}>
              <ShortsAuthorWorks
                handle={authorSheetFor.uploader.handle}
                currentId={items[Math.min(active, items.length - 1)]?.id ?? null}
                onSelect={jumpTo}
              />
            </div>
          </HostPanel>
        )}
      </AnimatePresence>
      </div>

      {/* RIGHT — 抖音-style detail/comments panel (desktop only) */}
      {items.length > 0 && (
        <aside className="hidden w-[400px] shrink-0 flex-col border-l border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 lg:flex xl:w-[440px]">
          <ShortsSidePanel
            item={items[Math.min(active, items.length - 1)]}
            currentUser={currentUser}
            tab={panelTab}
            onTabChange={setPanelTab}
            focusCommentId={
              pendingFocus && items[Math.min(active, items.length - 1)]?.id === pendingFocus.itemId
                ? pendingFocus.commentId
                : null
            }
            onJumpTo={jumpTo}
          />
        </aside>
      )}

      {uploadOpen && (
        <ShortsUploadDialog onClose={() => setUploadOpen(false)} onPublished={onPublished} />
      )}
      <AutoOpenComments
        enabled={initialFocus !== null || autoOpenComments}
        item={
          initialFocus
            ? (items.find((s) => s.id === initialFocus.itemId) ?? null)
            : (items[0] ?? null)
        }
        onOpen={openComments}
      />
    </div>
  );
}

function SortPill({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`relative drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] transition ${
        active ? 'font-semibold text-white' : 'font-medium text-white/60 hover:text-white/90'
      }`}
    >
      {label}
      {active && (
        <span className="absolute -bottom-1.5 left-1/2 h-0.5 w-5 -translate-x-1/2 rounded-full bg-white" />
      )}
    </Link>
  );
}

/** Opens the comment drawer once for a ?focus= deep link (notification click). */
function AutoOpenComments({
  enabled,
  item,
  onOpen,
}: {
  enabled: boolean;
  item: ShortView | null;
  onOpen: (item: ShortView) => void;
}) {
  const openedRef = useRef(false);
  useEffect(() => {
    if (!enabled || openedRef.current || !item) return;
    openedRef.current = true;
    onOpen(item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, item]);
  return null;
}
