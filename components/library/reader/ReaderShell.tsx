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
import { NotesPanel, filterCommunityNotes, type HighlightItem, type NoteUserFilter } from './NotesPanel';
import { ReaderChatPanel, type Citation } from './ReaderChatPanel';
import { MarginNotes } from './MarginNotes';
import type { CommunityNote } from './community-types';
import {
  MarkPopover,
  SelectionMenu,
  type HighlightColor,
  type SelectionContext,
  type SelectionPayload,
} from './SelectionMenu';
import { useReaderPrefs, READER_WIDTHS } from './reader-prefs';
import { ReaderHighlighter } from './highlighter';
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
}: Props) {
  const t = useTranslations('reader');
  const tc = useTranslations('common');
  const router = useRouter();
  const [prefs, updatePrefs] = useReaderPrefs();

  const chapterCount = Math.max(1, doc.chapterCount);
  const [currentChapter, setCurrentChapter] = useState(initialChapter);

  const [tocOpen, setTocOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(Boolean(initialChat));
  const [typographyOpen, setTypographyOpen] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [percent, setPercent] = useState(progress?.percent ?? 0);
  const [chapterHighlights, setChapterHighlights] = useState<HighlightItem[]>(highlights);
  const [hlVersion, setHlVersion] = useState(0);
  const [editNoteId, setEditNoteId] = useState<string | null>(null);
  const [markPopover, setMarkPopover] = useState<{ id: string; top: number; left: number } | null>(null);
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
      if (top < 64) setChromeVisible(true);
      else if (top > last + 4) setChromeVisible(false);
      else if (top < last - 4) setChromeVisible(true);
      lastScrollTopRef.current = top;
      setMarkPopover(null);
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
        else if (chatOpen) setChatOpen(false);
        else if (notesOpen) setNotesOpen(false);
        else if (tocOpen) setTocOpen(false);
        return;
      }
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (inField || markPopover || typographyOpen || lightbox) return;
      if (e.key === 'ArrowLeft') goChapter(currentChapter - 1);
      else if (e.key === 'ArrowRight') goChapter(currentChapter + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [typographyOpen, markPopover, chatOpen, notesOpen, tocOpen, lightbox, goChapter, currentChapter]);

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

  // Shared idempotent painter for the extracted view (effects + scroll repair).
  // Rebuild all highlights via the CSS Custom Highlight API. Ranges are LIVE
  // (they track the DOM), so this only runs when the highlight/community set
  // changes or chapters (re)mount — never on scroll. No DOM mutation ⇒ no React
  // conflict, no flicker, no drift.
  const renderMarks = useCallback(() => {
    const h = highlighterRef.current;
    if (!h || showOriginalPdf) return;
    const community = (
      showOthers && communityNotes ? filterCommunityNotes(communityNotes, userFilter) : []
    ).map((n) => ({
      id: n.id,
      chapterIndex: n.chapterIndex,
      quote: n.quote,
      charStart: n.charStart,
      color: n.color,
    }));
    h.renderAll(chapterRootsRef.current, chapterHighlights, community);
    setMarksVersion((v) => v + 1);
  }, [chapterHighlights, communityNotes, userFilter, showOthers, showOriginalPdf]);

  useEffect(() => {
    const id = requestAnimationFrame(renderMarks);
    return () => cancelAnimationFrame(id);
  }, [renderMarks, chaptersKey]);

  useEffect(() => () => highlighterRef.current?.dispose(), []);

  const handleCommunityJump = useCallback(
    (note: CommunityNote) => {
      setFocusNoteId(note.id);
      if (showOriginalPdf) setPdfView('text');
      const root = rootFor(note.chapterIndex);
      if (root && highlighterRef.current) {
        highlighterRef.current.flash(root, note.quote, note.charStart);
        return;
      }
      try {
        sessionStorage.setItem(
          PENDING_JUMP_KEY,
          JSON.stringify({
            chapterIndex: note.chapterIndex,
            charStart: note.charStart,
            snippet: note.quote.slice(0, 120),
          }),
        );
      } catch {
        /* ignore */
      }
      router.replace(readHref(note.chapterIndex), { scroll: false });
    },
    [readHref, rootFor, router, showOriginalPdf],
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

  const flashMark = useCallback((id: string): boolean => {
    return highlighterRef.current?.flashOwn(id) ?? false;
  }, []);

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
    let jump: { chapterIndex: number; charStart: number; snippet: string } | null = null;
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
    const { snippet, charStart } = jump;
    const timer = window.setTimeout(() => {
      if (typeof snippet === 'string') highlighterRef.current?.flash(root, snippet, charStart ?? 0);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [chaptersKey, marksVersion, rootFor, showOriginalPdf]);

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

  async function createHighlight(payload: SelectionPayload, color: HighlightColor, openNote: boolean) {
    const tempId = `temp-${Date.now()}`;
    const optimistic: HighlightItem = {
      id: tempId,
      ...payload,
      color,
      noteText: null,
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
        setHlVersion((v) => v + 1);
        if (openNote) {
          setEditNoteId(realId);
          setNotesOpen(true);
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

  async function recolor(id: string, color: HighlightColor) {
    setMarkPopover(null);
    // State change → renderMarks effect repaints (Custom Highlight API).
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
    const target = e.target as HTMLElement;
    // Images zoom into a lightbox.
    if (target.tagName === 'IMG' && getSelectionContext(target)) {
      const img = target as HTMLImageElement;
      setLightbox({ src: img.currentSrc || img.src, alt: img.alt ?? '' });
      return;
    }
    // Highlights are painted by the browser (no <mark> elements) — hit-test the
    // click point against the live ranges. Ignore clicks that are part of a
    // fresh selection.
    const h = highlighterRef.current;
    if (!h) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const community = h.communityHitAt(e.clientX, e.clientY);
    if (community) {
      setFocusNoteId(community);
      setNotesOpen(true);
      setMarkPopover(null);
      return;
    }
    const own = h.ownHitAt(e.clientX, e.clientY);
    if (own && !own.id.startsWith('temp-')) {
      setMarkPopover({ id: own.id, top: own.rect.bottom + 10, left: own.rect.left + own.rect.width / 2 });
      return;
    }
    setMarkPopover(null);
  }

  // ── chat wiring ───────────────────────────────────────────────────────

  const handleAskAi = useCallback(
    (quote: string) => {
      setChatPrefill({ text: t('ask_ai_prefill', { quote: quote.slice(0, 200) }), nonce: Date.now() });
      setChatOpen(true);
    },
    [t],
  );

  const handleCitationJump = useCallback(
    (citation: Citation) => {
      if (showOriginalPdf) setPdfView('text');
      const root = rootFor(citation.chapterIndex);
      if (root && highlighterRef.current) {
        highlighterRef.current.flash(root, citation.snippet, citation.charStart);
        return;
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
    [readHref, rootFor, router, showOriginalPdf],
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
      // State change drives the renderMarks effect (Custom Highlight API).
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
        onToggleNotes={() => setNotesOpen((v) => !v)}
        onToggleChat={() => setChatOpen((v) => !v)}
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
            className="h-full min-w-0 flex-1 overflow-y-auto overscroll-contain"
          >
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
              setNotesOpen(true);
            }}
          />
        )}

        <NotesPanel
          open={notesOpen}
          onClose={() => {
            setNotesOpen(false);
            setEditNoteId(null);
            setFocusNoteId(null);
          }}
          docId={doc.id}
          toc={toc}
          version={hlVersion}
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
        />

        <ReaderChatPanel
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          docId={doc.id}
          aiIndexState={doc.aiIndexState}
          questions={doc.aiOverview?.questions ?? []}
          prefill={chatPrefill}
          onCitationJump={handleCitationJump}
        />
      </div>

      {!showOriginalPdf && (
        <SelectionMenu
          getContext={getSelectionContext}
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

      {markPopover && (
        <MarkPopover
          top={markPopover.top}
          left={markPopover.left}
          currentColor={chapterHighlights.find((h) => h.id === markPopover.id)?.color ?? 'yellow'}
          onRecolor={(color) => void recolor(markPopover.id, color)}
          onNote={() => {
            setEditNoteId(markPopover.id);
            setNotesOpen(true);
            setMarkPopover(null);
          }}
          onDelete={() => void removeHighlight(markPopover.id)}
          onClose={() => setMarkPopover(null)}
        />
      )}

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
