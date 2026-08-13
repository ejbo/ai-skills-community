'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { FileText, Languages, Loader2, X } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import type { AiOverview } from '@/lib/library/types';
import { ReaderChrome } from './ReaderChrome';
import { ReaderContent } from './ReaderContent';
import { TocPanel, type TocEntry } from './TocPanel';
import { filterCommunityNotes, type HighlightItem, type NoteUserFilter } from './NotesPanel';
import { type Citation } from './ReaderChatPanel';
import { ReaderRightPanel, type RightTab } from './ReaderRightPanel';
import { MarginNotes } from './MarginNotes';
import type { CommunityNote } from './community-types';
import {
  CommunityNotePopover,
  MarkPopover,
  SelectionMenu,
  type HighlightColor,
  type SelectionContext,
  type SelectionPayload,
} from './SelectionMenu';
import { useReaderPrefs, READER_WIDTHS } from './reader-prefs';
import { ReaderHighlighter, supportsNativeHighlights, type HlBox } from './highlighter';
import { getTextOffsetOfPoint, invalidateAnchorCache, rootTextLength } from './anchoring';
import { withBasePath } from '@/lib/base-path';

export interface ReaderDocInfo {
  id: string;
  slug: string;
  title: string;
  author: string | null;
  docType: string;
  format: string;
  sourceUrl: string | null;
  siteName: string | null;
  fileUrl: string | null;
  chapterCount: number;
  wordCount: number;
  aiOverview: AiOverview | null;
  aiIndexState: string;
  language: string | null;
  commentCount: number;
}

interface ChapterPayload {
  chapterIndex: number;
  title: string | null;
  html: string;
}

interface Props {
  doc: ReaderDocInfo;
  mode: 'paged' | 'flow';
  flowAvailable: boolean;
  chapters: ChapterPayload[];
  initialChapter: number;
  toc: TocEntry[];
  progress: { chapterIndex: number; scrollRatio: number; percent: number; shareNotes: boolean } | null;
  highlights: HighlightItem[];
  initialChat: string | null;
  focusHighlightId: string | null;
  currentUser: { id: string; handle: string; isAdmin: boolean } | null;
}

const PENDING_JUMP_KEY = 'library:pendingJump';
const SHOW_OTHERS_KEY = 'library:showOthersNotes';

/**
 * Full-bleed reading surface. Panels (目录 / 笔记 / AI) are INLINE columns that
 * push the reading column aside; any combination can be open at once. Two
 * reading modes: 连续滚动 (flow — the whole doc in one scroll, default for web
 * articles) and 分章阅读 (paged).
 */
export function ReaderShell({
  doc,
  mode,
  flowAvailable,
  chapters,
  initialChapter,
  toc,
  progress,
  highlights,
  initialChat,
  focusHighlightId,
  currentUser,
}: Props) {
  const t = useTranslations('reader');
  const tc = useTranslations('common');
  const router = useRouter();
  const [prefs, updatePrefs] = useReaderPrefs();

  const chapterCount = Math.max(1, doc.chapterCount);
  const [currentChapter, setCurrentChapter] = useState(initialChapter);

  const [tocOpen, setTocOpen] = useState(false);
  // alphaXiv-style single right panel with tabs (助手/我的笔记/评论/相似).
  const [rightPanel, setRightPanel] = useState<{ open: boolean; tab: RightTab }>({
    open: Boolean(initialChat),
    tab: 'assistant',
  });
  const notesOpen = rightPanel.open && rightPanel.tab === 'notes';
  const chatOpen = rightPanel.open && rightPanel.tab === 'assistant';
  const openTab = useCallback((tab: RightTab) => setRightPanel({ open: true, tab }), []);
  const toggleTab = useCallback(
    (tab: RightTab) =>
      setRightPanel((p) => (p.open && p.tab === tab ? { ...p, open: false } : { open: true, tab })),
    [],
  );
  const closeRight = useCallback(() => setRightPanel((p) => ({ ...p, open: false })), []);
  const [typographyOpen, setTypographyOpen] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [percent, setPercent] = useState(progress?.percent ?? 0);
  const [chapterHighlights, setChapterHighlights] = useState<HighlightItem[]>(highlights);
  const [hlVersion, setHlVersion] = useState(0);
  const [editNoteId, setEditNoteId] = useState<string | null>(null);
  const [markPopover, setMarkPopover] = useState<{ id: string; top: number; left: number } | null>(null);
  const [communityPopover, setCommunityPopover] = useState<{
    id: string;
    top: number;
    left: number;
  } | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  // The mark popover hosts a note textarea — while it is open, nothing may
  // unmount the popover out from under an unsaved draft.
  const [editingMarkNote, setEditingMarkNote] = useState(false);
  // Mirror for the scroll listener, which is attached once and must not be
  // re-attached on every keystroke in the note editor.
  const editingMarkNoteRef = useRef(false);
  editingMarkNoteRef.current = editingMarkNote;
  const [hoveringMark, setHoveringMark] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const [chatPrefill, setChatPrefill] = useState<{ text: string; nonce: number } | null>(
    initialChat ? { text: initialChat, nonce: 0 } : null,
  );
  const [shareNotes, setShareNotes] = useState(progress?.shareNotes ?? false);
  const [showOthers, setShowOthers] = useState(true);
  const [communityNotes, setCommunityNotes] = useState<CommunityNote[] | null>(null);
  const [userFilter, setUserFilter] = useState<NoteUserFilter>({ hidden: [], only: [] });
  const [focusNoteId, setFocusNoteId] = useState<string | null>(null);
  const [communityRefresh, setCommunityRefresh] = useState(0);
  const [marksVersion, setMarksVersion] = useState(0);
  const [boxes, setBoxes] = useState<HlBox[]>([]);
  const [flashBoxes, setFlashBoxes] = useState<HlBox[]>([]);
  const flashTimerRef = useRef<number | null>(null);
  const [translate, setTranslate] = useState<{
    top: number;
    left: number;
    text: string;
    result: string | null;
    loading: boolean;
    error: string | null;
  } | null>(null);
  // PDF: 原版 = browser-native iframe (reliable, no annotation — browser
  // boundary); 精读 = extracted reader where highlights / notes / AI work.
  const [pdfView, setPdfView] = useState<'original' | 'text'>(
    doc.format === 'pdf' && doc.fileUrl ? 'original' : 'text',
  );
  const highlighterRef = useRef<ReaderHighlighter | null>(null);
  if (highlighterRef.current === null && typeof window !== 'undefined') {
    highlighterRef.current = new ReaderHighlighter();
  }
  // Native painting (CSS Custom Highlight API) needs no geometry at all: the
  // Ranges are live, so highlights follow every reflow on their own. Only the
  // overlay FALLBACK has to be recomputed on layout change.
  const nativeHl = typeof window !== 'undefined' && supportsNativeHighlights();

  const scrollRef = useRef<HTMLDivElement>(null);
  const chapterRootsRef = useRef(new Map<number, HTMLElement>());
  const registerFnsRef = useRef(new Map<number, (el: HTMLElement | null) => void>());
  const progressRef = useRef({
    chapterIndex: initialChapter,
    scrollRatio: progress?.scrollRatio ?? 0,
    percent: progress?.percent ?? 0,
  });
  const dirtyRef = useRef(false);
  const sendTimerRef = useRef<number | null>(null);
  const lastScrollTopRef = useRef(0);
  const restoredRef = useRef(false);
  const lastPagedChapterRef = useRef<number | null>(null);
  const flashedRef = useRef<string | null>(null);
  // Last in-article text selection, captured on pointer-up so the 我的笔记
  // composer can quote it even after focus moves to the textarea (which
  // collapses the live selection).
  const lastSelectionRef = useRef<SelectionPayload | null>(null);
  // True between pointerdown and pointerup inside the reading column.
  const draggingRef = useRef(false);
  // Latest `repaint` for listeners that must outlive its identity changes.
  const repaintRef = useRef<() => void>(() => {});
  const hoverRafRef = useRef<number | null>(null);

  const showOriginalPdf = doc.format === 'pdf' && pdfView === 'original' && !!doc.fileUrl;
  const visibleCommunityNotes = useMemo(
    () => (showOthers && communityNotes ? filterCommunityNotes(communityNotes, userFilter) : []),
    [showOthers, communityNotes, userFilter],
  );
  const communitySig = visibleCommunityNotes.map((n) => n.id).join(',');
  const chaptersKey = chapters.map((c) => c.chapterIndex).join(',');

  // Keep readHref stable per (slug, mode): only append view when it differs
  // from this doc's server-side default (url → flow, others → paged).
  const viewSuffix = useMemo(() => {
    const defaultMode = doc.format === 'url' && flowAvailable ? 'flow' : 'paged';
    return mode === defaultMode ? '' : `&view=${mode}`;
  }, [doc.format, flowAvailable, mode]);

  const readHref = useCallback(
    (n: number) => `/library/${doc.slug}/read?ch=${n}${viewSuffix}`,
    [doc.slug, viewSuffix],
  );

  const registerRoot = useCallback((ci: number) => {
    let fn = registerFnsRef.current.get(ci);
    if (!fn) {
      fn = (el: HTMLElement | null) => {
        if (el) chapterRootsRef.current.set(ci, el);
        else chapterRootsRef.current.delete(ci);
      };
      registerFnsRef.current.set(ci, fn);
    }
    return fn;
  }, []);

  const rootFor = useCallback((ci: number) => chapterRootsRef.current.get(ci) ?? null, []);

  const getSelectionContext = useCallback((node: Node): SelectionContext | null => {
    for (const [ci, root] of chapterRootsRef.current) {
      if (root.contains(node)) return { root, chapterIndex: ci };
    }
    return null;
  }, []);

  /**
   * Turn the live selection into an anchorable payload.
   *
   * Resolved from the range's START (then END) container rather than its
   * commonAncestorContainer: in 连续滚动 the common ancestor of a selection
   * spanning two chapters is the scroll container, and a selection that merely
   * touches the chapter <header> or the prev/next <nav> has a common ancestor
   * outside the <article> — both used to be dropped entirely, so the text
   * highlighted blue but no toolbar appeared and nothing could be saved. Such a
   * selection now anchors to the chapter it STARTS in, clamped to that
   * chapter's end.
   */
  const captureSelection = useCallback((): SelectionPayload | null => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    const ctx =
      getSelectionContext(range.startContainer) ?? getSelectionContext(range.endContainer);
    if (!ctx) return null;

    // CLAMP the range into the chosen root, then take the quote from the
    // clamped range — never from the raw selection. `quote` is the verification
    // key `locateMark` checks the offsets against, so a quote that starts with
    // text living OUTSIDE the article (the chapter <header>, the prev/next
    // <nav>) can never be anchored, and the highlight would save fine and then
    // be invisible and un-jumpable forever.
    const clamped = document.createRange();
    try {
      if (ctx.root.contains(range.startContainer)) {
        clamped.setStart(range.startContainer, range.startOffset);
      } else {
        clamped.setStart(ctx.root, 0);
      }
      if (ctx.root.contains(range.endContainer)) {
        clamped.setEnd(range.endContainer, range.endOffset);
      } else {
        clamped.setEnd(ctx.root, ctx.root.childNodes.length);
      }
    } catch {
      return null;
    }
    if (clamped.collapsed) return null;

    const full = clamped.toString().replace(/\s+/g, ' ').trim();
    if (!full) return null;
    const charStart = getTextOffsetOfPoint(ctx.root, clamped.startContainer, clamped.startOffset);
    const rawEnd = getTextOffsetOfPoint(ctx.root, clamped.endContainer, clamped.endOffset);
    // getTextOffsetOfPoint returns null when the browser rejects the point —
    // storing 0 there would anchor the highlight at the top of the chapter.
    if (charStart === null || rawEnd === null) return null;
    const charEnd = Math.max(rawEnd, charStart + 1);
    if (charEnd <= charStart) return null;
    // No length limit — the highlight is anchored by exact offsets, so any
    // span works. The quote is the verification key and the fallback anchor.
    return { chapterIndex: ctx.chapterIndex, quote: full.slice(0, 2000), charStart, charEnd };
  }, [getSelectionContext]);

  /** Top offset of a chapter root within the scroll container. */
  const rootTop = useCallback((root: HTMLElement) => {
    const el = scrollRef.current;
    if (!el) return 0;
    return root.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
  }, []);

  const scrollToChapter = useCallback(
    (ci: number, ratio = 0) => {
      const el = scrollRef.current;
      const root = rootFor(ci);
      if (!el || !root) return false;
      const top = rootTop(root) - 16 + ratio * root.offsetHeight;
      el.scrollTo({ top: Math.max(0, top), behavior: ratio > 0 ? 'auto' : 'smooth' });
      return true;
    },
    [rootFor, rootTop],
  );

  // Chapter navigation: flow scrolls in place; paged replaces the URL (the
  // whole reading session stays ONE history entry).
  const goChapter = useCallback(
    (n: number) => {
      if (n < 0 || n >= chapterCount) return;
      // 原版 PDF is the browser viewer (its own nav); a TOC jump switches to the
      // 精读 reader and navigates there.
      if (showOriginalPdf) {
        setPdfView('text');
        router.replace(readHref(n), { scroll: false });
        return;
      }
      if (mode === 'flow') {
        scrollToChapter(n);
        return;
      }
      if (n === currentChapter) return;
      router.replace(readHref(n), { scroll: false });
    },
    [chapterCount, currentChapter, mode, readHref, router, scrollToChapter, showOriginalPdf],
  );

  const changeMode = useCallback(
    (next: 'paged' | 'flow') => {
      if (next === mode) return;
      restoredRef.current = false; // re-anchor to the current chapter after the switch
      const defaultMode = doc.format === 'url' && flowAvailable ? 'flow' : 'paged';
      const suffix = next === defaultMode ? '' : `&view=${next}`;
      router.replace(`/library/${doc.slug}/read?ch=${currentChapter}${suffix}`, { scroll: false });
    },
    [mode, doc.format, doc.slug, flowAvailable, currentChapter, router],
  );

  const goBack = useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.push(`/library/${doc.slug}`);
  }, [router, doc.slug]);

  // ── progress ──────────────────────────────────────────────────────────

  const sendProgress = useCallback(
    (keepalive = false) => {
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      const p = progressRef.current;
      fetch(`/api/library/docs/${doc.id}/progress`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chapterIndex: p.chapterIndex,
          scrollRatio: Math.round(p.scrollRatio * 1000) / 1000,
          percent: Math.round(p.percent * 100) / 100,
        }),
        keepalive,
      }).catch(() => {});
    },
    [doc.id],
  );

  const schedulePatch = useCallback(() => {
    dirtyRef.current = true;
    if (sendTimerRef.current !== null) return;
    sendTimerRef.current = window.setTimeout(() => {
      sendTimerRef.current = null;
      sendProgress();
    }, 5000);
  }, [sendProgress]);

  const updateProgress = useCallback(() => {
    if (showOriginalPdf) return;
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    const globalRatio = max > 0 ? Math.min(1, Math.max(0, el.scrollTop / max)) : 1;

    if (mode === 'flow') {
      const anchor = el.scrollTop + el.clientHeight * 0.35;
      let ci = chapters[0]?.chapterIndex ?? 0;
      let ratio = 0;
      for (const c of chapters) {
        const root = rootFor(c.chapterIndex);
        if (!root) continue;
        const top = rootTop(root);
        if (top <= anchor) {
          ci = c.chapterIndex;
          ratio = Math.min(1, Math.max(0, (anchor - top) / Math.max(1, root.offsetHeight)));
        }
      }
      progressRef.current = { chapterIndex: ci, scrollRatio: ratio, percent: globalRatio * 100 };
      setPercent(globalRatio * 100);
      setCurrentChapter(ci);
    } else {
      const ci = chapters[0]?.chapterIndex ?? 0;
      const pct = Math.min(100, ((ci + globalRatio) / chapterCount) * 100);
      progressRef.current = { chapterIndex: ci, scrollRatio: globalRatio, percent: pct };
      setPercent(pct);
    }
    schedulePatch();
  }, [chapters, chapterCount, mode, rootFor, rootTop, schedulePatch, showOriginalPdf]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Progress tracks every scroll frame (throttling reads as "loads after I
    // stop"); the server PATCH stays debounced inside schedulePatch. Chrome
    // auto-hides on scroll-down, reappears on scroll-up. The throttled repaint
    // is belt-and-braces: apply* is idempotent, so if ANYTHING wiped the marks
    // they come back within ~600ms of scrolling.
    const onScroll = () => {
      const top = el.scrollTop;
      const last = lastScrollTopRef.current;
      // Do NOT collapse/expand the in-flow chrome while a selection drag is in
      // progress: toggling it resizes this scroll container, and the resulting
      // reflow shifts the text under the pointer and collapses the selection.
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        if (top < 64) setChromeVisible(true);
        else if (top > last + 4) setChromeVisible(false);
        else if (top < last - 4) setChromeVisible(true);
      }
      lastScrollTopRef.current = top;
      // Both popovers are `fixed` at viewport coordinates, so scrolling detaches
      // them from their mark — EXCEPT while the note editor is open, where
      // closing would throw away an unsaved draft.
      if (!editingMarkNoteRef.current) setMarkPopover(null);
      setCommunityPopover(null);
      updateProgress();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateProgress]);

  // Flush the last position when leaving (unmount, tab close, bfcache).
  useEffect(() => {
    const flush = () => {
      if (sendTimerRef.current !== null) {
        window.clearTimeout(sendTimerRef.current);
        sendTimerRef.current = null;
      }
      sendProgress(true);
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [sendProgress]);

  // Restore the reading position. Flow: once, to the initial chapter + saved
  // ratio. Paged: per chapter mount, same-chapter remounts (PDF 原文/文本
  // round-trips) restore the freshest in-session position.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || showOriginalPdf) return;
    if (mode === 'flow') {
      if (restoredRef.current) return;
      restoredRef.current = true;
      const ratio = progress && progress.chapterIndex === initialChapter ? progress.scrollRatio : 0;
      requestAnimationFrame(() => {
        if (initialChapter > 0 || ratio > 0) scrollToChapter(initialChapter, ratio);
        updateProgress();
      });
      return;
    }
    const ci = chapters[0]?.chapterIndex ?? 0;
    const sameChapter = lastPagedChapterRef.current === ci;
    const savedRatio = sameChapter
      ? progressRef.current.scrollRatio
      : progress && progress.chapterIndex === ci
        ? progress.scrollRatio
        : 0;
    lastPagedChapterRef.current = ci;
    setCurrentChapter(ci);
    requestAnimationFrame(() => {
      el.scrollTop = savedRatio > 0 ? savedRatio * Math.max(0, el.scrollHeight - el.clientHeight) : 0;
      setChromeVisible(true);
      updateProgress();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, chaptersKey, showOriginalPdf]);

  // ── page chrome / body lock ───────────────────────────────────────────

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // ── keyboard ──────────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const inField =
        !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (e.key === 'Escape') {
        // CJK IME users press Escape to cancel a composition; Escape inside a
        // field should only leave the field — never slam a panel shut.
        if (e.isComposing || e.keyCode === 229 || inField) return;
        if (lightbox) setLightbox(null);
        else if (typographyOpen) setTypographyOpen(false);
        else if (markPopover) setMarkPopover(null);
        else if (communityPopover) setCommunityPopover(null);
        else if (rightPanel.open) closeRight();
        else if (tocOpen) setTocOpen(false);
        return;
      }
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (inField || markPopover || communityPopover || typographyOpen || lightbox) return;
      if (e.key === 'ArrowLeft') goChapter(currentChapter - 1);
      else if (e.key === 'ArrowRight') goChapter(currentChapter + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [typographyOpen, markPopover, rightPanel.open, closeRight, tocOpen, lightbox, goChapter, currentChapter]);

  // ── community notes ───────────────────────────────────────────────────

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SHOW_OTHERS_KEY);
      if (raw !== null) setShowOthers(raw === 'true');
      const f = window.localStorage.getItem(`library:noteFilter:${doc.id}`);
      if (f) {
        const parsed = JSON.parse(f) as NoteUserFilter;
        if (parsed && Array.isArray(parsed.hidden) && Array.isArray(parsed.only)) {
          setUserFilter(parsed);
        }
      }
    } catch {
      /* ignore */
    }
  }, [doc.id]);

  const changeShowOthers = useCallback((v: boolean) => {
    setShowOthers(v);
    try {
      window.localStorage.setItem(SHOW_OTHERS_KEY, String(v));
    } catch {
      /* ignore */
    }
  }, []);

  const changeUserFilter = useCallback(
    (next: NoteUserFilter) => {
      setUserFilter(next);
      try {
        window.localStorage.setItem(`library:noteFilter:${doc.id}`, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
    [doc.id],
  );

  useEffect(() => {
    if (!showOthers && !notesOpen) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/library/docs/${doc.id}/notes`);
        const data = await res.json().catch(() => null);
        if (!cancelled && res.ok && Array.isArray(data?.notes)) setCommunityNotes(data.notes);
        else if (!cancelled) setCommunityNotes((prev) => prev ?? []);
      } catch {
        if (!cancelled) setCommunityNotes((prev) => prev ?? []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc.id, showOthers, notesOpen, communityRefresh]);

  // Re-locate every mark and hand the Ranges to the browser. On the native path
  // this touches no DOM and computes no geometry, so it can run at ANY time —
  // including mid-drag — without disturbing the selection. On the fallback path
  // it also returns overlay boxes to render.
  const repaint = useCallback(() => {
    const h = highlighterRef.current;
    const container = scrollRef.current;
    if (!h || !container || showOriginalPdf) {
      h?.clear();
      setBoxes([]);
      setFlashBoxes([]);
      return;
    }
    // Fallback path only: rendering overlay boxes mid-drag re-reads layout and
    // re-renders under the pointer. The native path registers Ranges, which
    // touches neither the DOM nor layout, so it is always safe to run.
    // The live-selection half self-heals a drag flag stranded true by a mouseup
    // the window never received (release outside the browser).
    if (!nativeHl && draggingRef.current) {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      draggingRef.current = false;
    }
    const community = (
      showOthers && communityNotes ? filterCommunityNotes(communityNotes, userFilter) : []
    ).map((n) => ({
      id: n.id,
      chapterIndex: n.chapterIndex,
      quote: n.quote,
      charStart: n.charStart,
      charEnd: n.charEnd,
      color: n.color,
    }));
    setBoxes(h.paint(chapterRootsRef.current, chapterHighlights, community, container));
    setMarksVersion((v) => v + 1);
  }, [chapterHighlights, communityNotes, userFilter, showOthers, showOriginalPdf, nativeHl]);

  // Kept in a ref (not read directly) so listeners that must outlive `repaint`'s
  // identity — the MutationObserver below — never need to be torn down.
  useEffect(() => {
    repaintRef.current = repaint;
  }, [repaint]);

  useEffect(() => {
    if (showOriginalPdf) {
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
      highlighterRef.current?.clear();
      setBoxes([]);
      setFlashBoxes([]);
      return;
    }
    const container = scrollRef.current;
    if (!container) return;
    const raf = requestAnimationFrame(repaint);
    // Text nodes settle asynchronously (fonts, late images) — a couple of
    // retries so a mark whose text was not laid out yet still lands.
    const t1 = window.setTimeout(repaint, 350);
    const t2 = window.setTimeout(repaint, 1200);
    if (nativeHl) {
      // Live Ranges follow reflow by themselves: no resize observer, no scroll
      // repaint, no per-frame geometry. That whole loop is what used to starve
      // the main thread of mousemove events during a drag.
      return () => {
        cancelAnimationFrame(raf);
        window.clearTimeout(t1);
        window.clearTimeout(t2);
      };
    }
    const onResize = () => repaint();
    window.addEventListener('resize', onResize);
    // The reading column reflows when a side panel (笔记/AI) opens or closes,
    // which never fires a window resize — observe the container itself.
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => repaint());
      ro.observe(container);
    }
    const onLoad = (e: Event) => {
      if ((e.target as HTMLElement | null)?.tagName === 'IMG') repaint();
    };
    container.addEventListener('load', onLoad, true);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
      container.removeEventListener('load', onLoad, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repaint, nativeHl, chaptersKey, prefs.fontSize, prefs.lineHeight, prefs.width, prefs.serif]);

  // Remember the last real in-article selection so the 我的笔记 composer can
  // quote it after focus moves to the textarea (which collapses the live one).
  useEffect(() => {
    if (showOriginalPdf) return;
    const onPointerDown = (e: Event) => {
      const el = scrollRef.current;
      draggingRef.current = !!el && e.target instanceof Node && el.contains(e.target);
    };
    const onPointerUp = () => {
      const wasDragging = draggingRef.current;
      draggingRef.current = false;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
        // An unresolvable selection must CLEAR the ref, not leave the previous
        // one standing — otherwise the composer silently anchors the note to a
        // passage the user selected minutes ago, possibly in another chapter.
        lastSelectionRef.current = captureSelection();
      }
      // Fallback path: reconcile any layout change the drag guard skipped.
      if (wasDragging && !nativeHl) requestAnimationFrame(repaint);
    };
    // window blur is the backstop: releasing the button outside the browser
    // delivers no mouseup, which would strand the flag true forever.
    const onLostPointer = () => {
      draggingRef.current = false;
    };
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('touchstart', onPointerDown, true);
    document.addEventListener('mouseup', onPointerUp);
    document.addEventListener('touchend', onPointerUp);
    document.addEventListener('touchcancel', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('blur', onLostPointer);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('touchstart', onPointerDown, true);
      document.removeEventListener('mouseup', onPointerUp);
      document.removeEventListener('touchend', onPointerUp);
      document.removeEventListener('touchcancel', onPointerUp);
      document.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('blur', onLostPointer);
    };
  }, [showOriginalPdf, captureSelection, nativeHl, repaint]);

  /**
   * Recover from anything that rewrites the article's text nodes under us —
   * chiefly Chrome/Edge in-page translation, which replaces every text node and
   * silently collapses the anchored Ranges (highlights would just vanish).
   * Debounced, and it never observes the overlay layer, so a repaint on the
   * fallback path cannot retrigger it.
   */
  useEffect(() => {
    if (showOriginalPdf || typeof MutationObserver === 'undefined') return;
    const roots = Array.from(chapterRootsRef.current.values());
    if (roots.length === 0) return;
    let timer: number | null = null;
    const observer = new MutationObserver(() => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        for (const root of roots) invalidateAnchorCache(root);
        // Through a ref so the observer survives every highlight-set change.
        repaintRef.current();
      }, 400);
    });
    for (const root of roots) {
      observer.observe(root, { childList: true, subtree: true, characterData: true });
    }
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaptersKey, showOriginalPdf]);

  // A selection anchored in a chapter that is no longer mounted cannot be saved.
  useEffect(() => {
    lastSelectionRef.current = null;
  }, [chaptersKey]);

  // Flash a range: paint it, scroll it into view, auto-clear.
  const doFlash = useCallback((range: Range | null): boolean => {
    const h = highlighterRef.current;
    const container = scrollRef.current;
    if (!h || !container || !range) return false;
    h.scrollTo(range);
    const fb = h.setFlash(range, container);
    setFlashBoxes(fb);
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => {
      h.setFlash(null, container);
      setFlashBoxes([]);
    }, 2400);
    return true;
  }, []);

  // CSS.highlights is a document-global registry keyed by a CONSTANT name, so
  // teardown has to cancel the flash timer too: an orphan timer from a closed
  // reader would delete the flash the NEXT reader just registered.
  useEffect(() => {
    const h = highlighterRef.current;
    return () => {
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
      h?.clear();
    };
  }, []);

  const handleCommunityJump = useCallback(
    (note: CommunityNote) => {
      setFocusNoteId(note.id);
      if (showOriginalPdf) setPdfView('text');
      const root = rootFor(note.chapterIndex);
      const h = highlighterRef.current;
      if (root && h) {
        if (doFlash(h.locateFlash(root, note))) return;
      }
      try {
        sessionStorage.setItem(
          PENDING_JUMP_KEY,
          JSON.stringify({
            chapterIndex: note.chapterIndex,
            charStart: note.charStart,
            charEnd: note.charEnd,
            snippet: note.quote.slice(0, 200),
          }),
        );
      } catch {
        /* ignore */
      }
      router.replace(readHref(note.chapterIndex), { scroll: false });
    },
    [doFlash, readHref, rootFor, router, showOriginalPdf],
  );

  const handleReplyAdded = useCallback(
    (noteId: string, reply: CommunityNote['replies'][number]) => {
      setCommunityNotes((prev) =>
        prev
          ? prev.map((n) =>
              n.id === noteId
                ? { ...n, replyCount: n.replyCount + 1, replies: [...n.replies, reply] }
                : n,
            )
          : prev,
      );
    },
    [],
  );

  // ── own highlights ────────────────────────────────────────────────────

  useEffect(() => setChapterHighlights(highlights), [highlights]);

  // Flash an own highlight by id: locate its range in the mounted chapter, then
  // render flash boxes. Uses the highlight set (offsets), not any injected DOM.
  const flashMark = useCallback(
    (id: string): boolean => {
      const hl = chapterHighlights.find((h) => h.id === id);
      if (!hl) return false;
      const root = rootFor(hl.chapterIndex);
      const h = highlighterRef.current;
      if (!root || !h) return false;
      return doFlash(h.locateFlash(root, hl));
    },
    [chapterHighlights, doFlash, rootFor],
  );

  // ?hl= deep link: scroll to the mark and flash it (once per id).
  useEffect(() => {
    if (!focusHighlightId || flashedRef.current === focusHighlightId) return;
    const timer = window.setTimeout(() => {
      if (flashMark(focusHighlightId)) flashedRef.current = focusHighlightId;
    }, 300);
    return () => window.clearTimeout(timer);
  }, [focusHighlightId, chaptersKey, marksVersion, flashMark]);

  // Cross-chapter jump left in sessionStorage (paged navigation only).
  useEffect(() => {
    if (showOriginalPdf) return;
    let jump: { chapterIndex: number; charStart: number; charEnd?: number; snippet: string } | null =
      null;
    try {
      const raw = sessionStorage.getItem(PENDING_JUMP_KEY);
      if (raw) jump = JSON.parse(raw);
    } catch {
      jump = null;
    }
    if (!jump) return;
    const root = rootFor(jump.chapterIndex);
    if (!root) return;
    try {
      sessionStorage.removeItem(PENDING_JUMP_KEY);
    } catch {
      /* ignore */
    }
    const { snippet, charStart, charEnd } = jump;
    const timer = window.setTimeout(() => {
      const h = highlighterRef.current;
      if (!h) return;
      // Notes/highlights carry charEnd → exact offset flash; citations don't.
      const range =
        typeof charEnd === 'number'
          ? h.locateFlash(root, { charStart, charEnd, quote: snippet })
          : typeof snippet === 'string'
            ? h.locateCitation(root, snippet, charStart ?? 0)
            : null;
      doFlash(range);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [chaptersKey, marksVersion, rootFor, showOriginalPdf, doFlash]);

  const resyncChapterHighlights = useCallback(async () => {
    try {
      const res = await fetch(
        mode === 'flow'
          ? `/api/library/docs/${doc.id}/highlights`
          : `/api/library/docs/${doc.id}/highlights?chapter=${currentChapter}`,
      );
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        const list = (data.highlights ?? []) as HighlightItem[];
        if (Array.isArray(list)) setChapterHighlights(list);
      }
    } catch {
      /* keep optimistic state */
    }
    setHlVersion((v) => v + 1);
  }, [doc.id, currentChapter, mode]);

  async function createHighlight(
    payload: SelectionPayload,
    color: HighlightColor,
    openNote: boolean,
    noteText?: string,
  ) {
    const tempId = `temp-${Date.now()}`;
    const seededNote = noteText?.trim() || null;
    const optimistic: HighlightItem = {
      id: tempId,
      ...payload,
      color,
      noteText: seededNote,
      createdAt: new Date().toISOString(),
    };
    setChapterHighlights((prev) => [...prev, optimistic]);
    try {
      const res = await fetch(`/api/library/docs/${doc.id}/highlights`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, color }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setChapterHighlights((prev) => prev.filter((h) => h.id !== tempId));
        pushToast(
          'error',
          data?.error === 'too_many'
            ? t('highlight_limit_reached')
            : data?.error === 'rate_limited'
              ? t('too_frequent_retry')
              : t('highlight_save_failed'),
        );
        return;
      }
      const saved = (data?.highlight ?? data) as { id?: unknown } | null;
      const realId = saved && typeof saved.id === 'string' ? saved.id : null;
      if (realId) {
        setChapterHighlights((prev) => prev.map((h) => (h.id === tempId ? { ...h, id: realId } : h)));
        // Attach the seeded note (composer path) in a follow-up PATCH.
        if (seededNote) {
          void fetch(`/api/library/docs/${doc.id}/highlights/${realId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ noteText: seededNote }),
          }).finally(() => setHlVersion((v) => v + 1));
        }
        setHlVersion((v) => v + 1);
        if (openNote) {
          setEditNoteId(realId);
          openTab('notes');
        }
      } else {
        setChapterHighlights((prev) => prev.filter((h) => h.id !== tempId));
        void resyncChapterHighlights();
      }
    } catch {
      setChapterHighlights((prev) => prev.filter((h) => h.id !== tempId));
      pushToast('error', t('network_highlight_not_saved'));
    }
  }

  // 我的笔记 composer: turn the last in-article selection into a highlight that
  // carries `noteText`. Returns false when there's nothing selected to anchor.
  const saveSelectionNote = useCallback(
    (noteText: string): boolean => {
      const payload = lastSelectionRef.current;
      const body = noteText.trim();
      if (!payload || !body) return false;
      lastSelectionRef.current = null;
      void createHighlight(payload, 'yellow', false, body);
      return true;
    },
    // createHighlight is a stable function declaration in this scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  async function recolor(id: string, color: HighlightColor) {
    // Deliberately does NOT close the popover: the palette sits next to the note
    // editor, so closing would discard an unsaved draft. The popover re-renders
    // with the new `currentColor` from the state change below.
    // The state change re-runs `repaint`, which re-registers the ranges.
    setChapterHighlights((prev) => prev.map((h) => (h.id === id ? { ...h, color } : h)));
    try {
      const res = await fetch(`/api/library/docs/${doc.id}/highlights/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ color }),
      });
      if (!res.ok) {
        pushToast('error', t('update_failed'));
        void resyncChapterHighlights();
      } else {
        setHlVersion((v) => v + 1);
      }
    } catch {
      pushToast('error', t('network_update_not_saved'));
      void resyncChapterHighlights();
    }
  }

  async function removeHighlight(id: string) {
    setMarkPopover(null);
    setChapterHighlights((prev) => prev.filter((h) => h.id !== id));
    try {
      const res = await fetch(`/api/library/docs/${doc.id}/highlights/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        pushToast('error', t('delete_failed'));
        void resyncChapterHighlights();
      } else {
        setHlVersion((v) => v + 1);
      }
    } catch {
      pushToast('error', t('network_delete_failed'));
      void resyncChapterHighlights();
    }
  }

  function onContentClick(e: React.MouseEvent) {
    // A drag that ENDS on an image must not open the lightbox — check for a
    // live selection before anything else.
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;

    const target = e.target as HTMLElement;
    if (target.tagName === 'IMG' && getSelectionContext(target)) {
      const img = target as HTMLImageElement;
      setLightbox({ src: img.currentSrc || img.src, alt: img.alt ?? '' });
      return;
    }
    // Marks are painted by the browser (no elements to click) — hit-test the
    // click point against the live ranges, exactly (caretPositionFromPoint +
    // isPointInRange), so blank space beside a highlighted line is not a hit.
    const h = highlighterRef.current;
    if (!h) return;
    const own = h.ownHitAt(e.clientX, e.clientY);
    if (own && !own.id.startsWith('temp-')) {
      setCommunityPopover(null);
      setMarkPopover({ id: own.id, top: own.rect.bottom + 10, left: own.rect.left + own.rect.width / 2 });
      return;
    }
    const community = h.communityHitAt(e.clientX, e.clientY);
    if (community) {
      setMarkPopover(null);
      setFocusNoteId(community.id);
      setCommunityPopover({
        id: community.id,
        top: community.rect.bottom + 10,
        left: community.rect.left + community.rect.width / 2,
      });
      return;
    }
    setMarkPopover(null);
    setCommunityPopover(null);
  }

  // Painted marks have no element to hang a cursor on — hit-test on move so a
  // clickable annotation still LOOKS clickable. Coalesced to one test per frame:
  // hit-testing reads layout per mark and a doc may carry hundreds.
  const onContentMove = useCallback((e: React.MouseEvent) => {
    if (hoverRafRef.current !== null) return;
    const { clientX, clientY } = e;
    hoverRafRef.current = requestAnimationFrame(() => {
      hoverRafRef.current = null;
      const h = highlighterRef.current;
      if (!h) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return; // mid-drag: leave the I-beam alone
      setHoveringMark(h.anyHitAt(clientX, clientY));
    });
  }, []);

  useEffect(
    () => () => {
      if (hoverRafRef.current !== null) cancelAnimationFrame(hoverRafRef.current);
    },
    [],
  );

  /** Save (or clear) the note on an existing highlight, from the mark popover.
   *  Resolves to whether it persisted — the popover keeps the draft on false. */
  async function saveMarkNote(id: string, text: string): Promise<boolean> {
    const noteText = text.trim() || null;
    const prev = chapterHighlights.find((h) => h.id === id)?.noteText ?? null;
    setSavingNote(true);
    setChapterHighlights((list) => list.map((h) => (h.id === id ? { ...h, noteText } : h)));
    try {
      const res = await fetch(`/api/library/docs/${doc.id}/highlights/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ noteText: noteText ?? '' }),
      });
      if (!res.ok) throw new Error('failed');
      setHlVersion((v) => v + 1);
      return true;
    } catch {
      setChapterHighlights((list) => list.map((h) => (h.id === id ? { ...h, noteText: prev } : h)));
      pushToast('error', t('note_save_failed'));
      return false;
    } finally {
      setSavingNote(false);
    }
  }

  // ── chat wiring ───────────────────────────────────────────────────────

  const handleAskAi = useCallback(
    (quote: string) => {
      setChatPrefill({ text: t('ask_ai_prefill', { quote: quote.slice(0, 200) }), nonce: Date.now() });
      openTab('assistant');
    },
    [t, openTab],
  );

  const handleCitationJump = useCallback(
    (citation: Citation) => {
      if (showOriginalPdf) setPdfView('text');
      const root = rootFor(citation.chapterIndex);
      const h = highlighterRef.current;
      if (root && h) {
        if (doFlash(h.locateCitation(root, citation.snippet, citation.charStart))) return;
      }
      try {
        sessionStorage.setItem(
          PENDING_JUMP_KEY,
          JSON.stringify({
            chapterIndex: citation.chapterIndex,
            charStart: citation.charStart,
            snippet: citation.snippet,
          }),
        );
      } catch {
        /* ignore */
      }
      router.replace(readHref(citation.chapterIndex), { scroll: false });
    },
    [doFlash, readHref, rootFor, router, showOriginalPdf],
  );

  const handleOwnJump = useCallback(
    (hl: { id: string; chapterIndex: number }) => {
      if (showOriginalPdf) setPdfView('text');
      if (flashMark(hl.id)) return;
      if (rootFor(hl.chapterIndex)) {
        scrollToChapter(hl.chapterIndex);
        return;
      }
      flashedRef.current = null;
      router.replace(`${readHref(hl.chapterIndex)}&hl=${hl.id}`, { scroll: false });
    },
    [flashMark, readHref, rootFor, router, scrollToChapter, showOriginalPdf],
  );

  const handleOwnMutated = useCallback(
    (id: string, patch: { color?: string; noteText?: string | null } | null) => {
      // The state change re-runs `repaint`, which re-registers the ranges.
      if (patch === null) {
        setChapterHighlights((prev) => prev.filter((h) => h.id !== id));
      } else {
        setChapterHighlights((prev) =>
          prev.map((h) =>
            h.id === id
              ? {
                  ...h,
                  ...(patch.color ? { color: patch.color } : {}),
                  ...('noteText' in patch ? { noteText: patch.noteText ?? null } : {}),
                }
              : h,
          ),
        );
      }
    },
    [],
  );

  const handleTranslate = useCallback((text: string, anchorPos: { top: number; left: number }) => {
    setTranslate({
      top: Math.min(anchorPos.top + 16, window.innerHeight - 200),
      left: Math.min(Math.max(anchorPos.left, 180), window.innerWidth - 180),
      text,
      result: null,
      loading: true,
      error: null,
    });
    void (async () => {
      try {
        const res = await fetch('/api/library/translate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        const data = await res.json().catch(() => ({}));
        setTranslate((prev) =>
          prev && prev.text === text
            ? {
                ...prev,
                loading: false,
                result: res.ok ? (data.translation ?? null) : null,
                error: res.ok ? null : (data?.reason ?? t('translate_failed_retry')),
              }
            : prev,
        );
      } catch {
        setTranslate((prev) =>
          prev && prev.text === text ? { ...prev, loading: false, error: t('network_error_retry') } : prev,
        );
      }
    })();
  }, [t]);

  // ── render ────────────────────────────────────────────────────────────

  const currentTitle = toc.find((c) => c.chapterIndex === currentChapter)?.title ?? null;
  const chapterLabel =
    chapterCount > 1
      ? `${t('chapter_x_of_y', { current: currentChapter + 1, total: chapterCount })}${
          currentTitle ? ` · ${currentTitle}` : ''
        }`
      : (doc.siteName ?? doc.author ?? null);

  return (
    <div
      className="reader-root fixed inset-0 z-50 flex flex-col overflow-hidden"
      data-reader-theme={prefs.theme}
      data-reader-serif={prefs.serif ? 'true' : 'false'}
      style={
        {
          '--reader-font-size': `${prefs.fontSize}px`,
          '--reader-line-height': String(prefs.lineHeight),
          '--reader-width': READER_WIDTHS[prefs.width],
        } as React.CSSProperties
      }
    >
      {/* Always-visible reading progress — pinned to the very top, independent
          of the collapsible chrome, tracking every scroll frame. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-40 h-0.5">
        <div
          className="h-full bg-accent-500"
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>

      <ReaderChrome
        visible={chromeVisible}
        onBack={goBack}
        title={doc.title}
        chapterLabel={chapterLabel}
        sourceUrl={doc.sourceUrl}
        tocOpen={tocOpen}
        notesOpen={notesOpen}
        chatOpen={chatOpen}
        onToggleToc={() => setTocOpen((v) => !v)}
        onToggleNotes={() => toggleTab('notes')}
        onToggleChat={() => toggleTab('assistant')}
        typographyOpen={typographyOpen}
        onToggleTypography={() => setTypographyOpen((v) => !v)}
        onCloseTypography={() => setTypographyOpen(false)}
        prefs={prefs}
        onPrefsChange={updatePrefs}
        flow={
          doc.format !== 'pdf' && chapterCount > 1
            ? { mode, available: flowAvailable, onChange: changeMode }
            : null
        }
        pdfMode={
          doc.format === 'pdf' && doc.fileUrl
            ? {
                view: pdfView,
                canAnnotate: chapters.length > 0,
                onChange: setPdfView,
              }
            : null
        }
      />

      <div className="relative flex min-h-0 flex-1">
        <TocPanel
          open={tocOpen}
          onClose={() => setTocOpen(false)}
          toc={toc}
          current={currentChapter}
          onSelect={(n) => goChapter(n)}
        />

        {showOriginalPdf ? (
          // 原版: the browser's own PDF viewer — pixel-faithful, reliable
          // selection/zoom. Annotation lives in the 精读 view (toggle above).
          <iframe
            src={`${withBasePath(doc.fileUrl!)}#view=FitH`}
            title={doc.title}
            className="h-full min-w-0 flex-1 border-0"
          />
        ) : (
          <div
            ref={scrollRef}
            onClick={onContentClick}
            onMouseMove={onContentMove}
            onMouseLeave={() => setHoveringMark(false)}
            className={`relative h-full min-w-0 flex-1 overflow-y-auto overscroll-contain ${
              hoveringMark ? 'reader-scroll-hit' : ''
            }`}
          >
            {/* Fallback overlay only — empty on browsers with CSS.highlights,
                where the marks are painted by the browser itself. */}
            <div className="reader-hl-layer" aria-hidden>
              {boxes.map((b) => (
                <div
                  key={b.key}
                  className={`reader-hl-box ${
                    b.kind === 'community'
                      ? 'reader-hl-box-community'
                      : `reader-hl-box-${b.color}`
                  }`}
                  style={{ top: b.top, left: b.left, width: b.width, height: b.height }}
                />
              ))}
              {flashBoxes.map((b) => (
                <div
                  key={b.key}
                  className="reader-hl-box reader-hl-box-flash"
                  style={{ top: b.top, left: b.left, width: b.width, height: b.height }}
                />
              ))}
            </div>
            {chapters.length > 0 ? (
              chapters.map((ch) => (
                <section key={ch.chapterIndex} data-chapter-index={ch.chapterIndex}>
                  <ReaderContent
                    html={ch.html}
                    docTitle={doc.title}
                    author={doc.author}
                    siteName={doc.siteName}
                    chapterIndex={ch.chapterIndex}
                    chapterTitle={ch.title}
                    chapterCount={chapterCount}
                    mode={mode}
                    readHref={readHref}
                    registerRoot={registerRoot(ch.chapterIndex)}
                  />
                </section>
              ))
            ) : (
              <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 pt-40 text-center">
                <FileText className="r-muted h-8 w-8" />
                <p className="text-sm font-medium">{t('no_readable_text')}</p>
              </div>
            )}
          </div>
        )}

        {!showOriginalPdf && (
          <MarginNotes
            containerRef={scrollRef}
            notes={visibleCommunityNotes}
            version={`${communitySig}|${marksVersion}|${currentChapter}`}
            getRect={(id) => highlighterRef.current?.communityRect(id) ?? null}
            onJump={handleCommunityJump}
            onOpenPanel={(noteId) => {
              setFocusNoteId(noteId);
              openTab('notes');
            }}
          />
        )}

        {rightPanel.open && (
          <ReaderRightPanel
            tab={rightPanel.tab}
            onTabChange={openTab}
            onClose={() => {
              closeRight();
              setEditNoteId(null);
              setFocusNoteId(null);
            }}
            currentUser={currentUser}
            docId={doc.id}
            aiIndexState={doc.aiIndexState}
            questions={doc.aiOverview?.questions ?? []}
            prefill={chatPrefill}
            onCitationJump={handleCitationJump}
            toc={toc}
            notesVersion={hlVersion}
            editNoteId={editNoteId}
            onJumpOwn={handleOwnJump}
            onMutatedOwn={handleOwnMutated}
            communityNotes={communityNotes}
            onReplyAdded={handleReplyAdded}
            shareNotes={shareNotes}
            onShareNotesChange={(v) => {
              setShareNotes(v);
              setCommunityRefresh((n) => n + 1);
            }}
            showOthers={showOthers}
            onShowOthersChange={changeShowOthers}
            userFilter={userFilter}
            onUserFilterChange={changeUserFilter}
            focusNoteId={focusNoteId}
            onJumpCommunity={handleCommunityJump}
            onSaveSelectionNote={saveSelectionNote}
            commentCount={doc.commentCount}
          />
        )}
      </div>

      {!showOriginalPdf && (
        <SelectionMenu
          capture={captureSelection}
          onHighlight={(payload, color) => void createHighlight(payload, color, false)}
          onNote={(payload) => void createHighlight(payload, 'yellow', true)}
          onAskAi={handleAskAi}
          onTranslate={handleTranslate}
        />
      )}

      {translate && (
        <div
          className="reader-panel rborder fixed z-50 w-80 -translate-x-1/2 rounded-xl border p-3 shadow-xl"
          style={{ top: translate.top, left: translate.left }}
          role="dialog"
          aria-label={t('translate')}
        >
          <div className="flex items-center gap-1.5">
            <Languages className="h-3.5 w-3.5 text-accent-500" />
            <span className="text-xs font-semibold">{t('translate')}</span>
            <button
              type="button"
              onClick={() => setTranslate(null)}
              aria-label={tc('dismiss')}
              className="r-muted ml-auto grid h-6 w-6 place-items-center rounded-md transition hover:bg-[var(--reader-hover)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="r-muted mt-2 line-clamp-2 border-l-2 border-[var(--reader-border)] pl-2 text-xs">
            {translate.text}
          </p>
          <div className="mt-2 max-h-48 overflow-y-auto text-sm leading-relaxed">
            {translate.loading ? (
              <span className="r-muted flex items-center gap-1.5 text-xs">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('translating')}
              </span>
            ) : translate.error ? (
              <span className="text-xs text-danger">{translate.error}</span>
            ) : (
              <span className="whitespace-pre-wrap">{translate.result}</span>
            )}
          </div>
        </div>
      )}

      {markPopover &&
        (() => {
          const hl = chapterHighlights.find((h) => h.id === markPopover.id);
          if (!hl) return null;
          return (
            <MarkPopover
              top={markPopover.top}
              left={markPopover.left}
              quote={hl.quote}
              currentColor={hl.color}
              noteText={hl.noteText}
              saving={savingNote}
              onRecolor={(color) => void recolor(markPopover.id, color)}
              onSaveNote={(text) => saveMarkNote(markPopover.id, text)}
              onEditingChange={setEditingMarkNote}
              onOpenInPanel={() => {
                setEditNoteId(markPopover.id);
                openTab('notes');
                setMarkPopover(null);
              }}
              onDelete={() => void removeHighlight(markPopover.id)}
              onClose={() => setMarkPopover(null)}
            />
          );
        })()}

      {communityPopover &&
        (() => {
          const note = communityNotes?.find((n) => n.id === communityPopover.id);
          if (!note) return null;
          return (
            <CommunityNotePopover
              top={communityPopover.top}
              left={communityPopover.left}
              authorName={note.author.displayName}
              quote={note.quote}
              noteText={note.noteText}
              replyCount={note.replyCount}
              onOpenInPanel={() => {
                setFocusNoteId(note.id);
                openTab('notes');
                setCommunityPopover(null);
              }}
              onClose={() => setCommunityPopover(null)}
            />
          );
        })()}

      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('view_image')}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-6"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            aria-label={tc('dismiss')}
            onClick={() => setLightbox(null)}
            className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-lg text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element -- lightbox of an in-article image */}
          <img
            src={lightbox.src}
            alt={lightbox.alt}
            className="max-h-full max-w-full cursor-zoom-out rounded-lg object-contain shadow-2xl"
          />
        </div>
      )}
    </div>
  );
}
