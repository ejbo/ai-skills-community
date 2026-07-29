'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText } from 'lucide-react';
import { withBasePath } from '@/lib/base-path';
import { pushToast } from '@/components/Toaster';
import type { AiOverview } from '@/lib/library/types';
import { ReaderChrome } from './ReaderChrome';
import { ReaderContent } from './ReaderContent';
import { TocDrawer, type TocEntry } from './TocDrawer';
import { HighlightsDrawer, type HighlightItem } from './HighlightsDrawer';
import { ReaderChatPanel, type Citation } from './ReaderChatPanel';
import { MarkPopover, SelectionMenu, type HighlightColor, type SelectionPayload } from './SelectionMenu';
import { useReaderPrefs, READER_WIDTHS } from './reader-prefs';
import {
  applyHighlights,
  clearHighlights,
  esc,
  flashQuote,
  recolorHighlight,
  removeHighlightMarks,
} from './anchoring';

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
  aiOverview: AiOverview | null;
  aiIndexState: string;
  language: string | null;
}

interface Props {
  doc: ReaderDocInfo;
  chapter: { chapterIndex: number; title: string | null; html: string } | null;
  toc: TocEntry[];
  progress: { chapterIndex: number; scrollRatio: number; percent: number } | null;
  highlights: HighlightItem[];
  initialChat: string | null;
  focusHighlightId: string | null;
}

const PENDING_JUMP_KEY = 'library:pendingJump';

type DrawerKind = 'toc' | 'highlights' | 'chat';

/** Full-bleed reading surface orchestrating chrome, content, drawers and chat. */
export function ReaderShell({
  doc,
  chapter,
  toc,
  progress,
  highlights,
  initialChat,
  focusHighlightId,
}: Props) {
  const router = useRouter();
  const [prefs, updatePrefs] = useReaderPrefs();

  const chapterIndex = chapter?.chapterIndex ?? 0;
  const chapterCount = Math.max(1, doc.chapterCount);

  const [drawer, setDrawer] = useState<DrawerKind | null>(initialChat ? 'chat' : null);
  const [typographyOpen, setTypographyOpen] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [percent, setPercent] = useState(progress?.percent ?? 0);
  const [chapterHighlights, setChapterHighlights] = useState<HighlightItem[]>(highlights);
  const [hlVersion, setHlVersion] = useState(0);
  const [drawerNoteId, setDrawerNoteId] = useState<string | null>(null);
  const [markPopover, setMarkPopover] = useState<{ id: string; top: number; left: number } | null>(null);
  const [chatPrefill, setChatPrefill] = useState<{ text: string; nonce: number } | null>(
    initialChat ? { text: initialChat, nonce: 0 } : null,
  );
  const [pdfView, setPdfView] = useState<'original' | 'text'>(
    doc.format === 'pdf' && doc.fileUrl ? 'original' : 'text',
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const progressRef = useRef({
    chapterIndex,
    scrollRatio: progress?.scrollRatio ?? 0,
    percent: progress?.percent ?? 0,
  });
  const dirtyRef = useRef(false);
  const sendTimerRef = useRef<number | null>(null);
  const lastScrollTopRef = useRef(0);
  const lastChapterRef = useRef<number | null>(null);
  const flashedRef = useRef<string | null>(null);

  const showOriginalPdf = doc.format === 'pdf' && pdfView === 'original' && !!doc.fileUrl;

  const readHref = useCallback(
    (n: number) => `/library/${doc.slug}/read?ch=${n}`,
    [doc.slug],
  );

  const goChapter = useCallback(
    (n: number) => {
      if (n < 0 || n >= chapterCount || n === chapterIndex) return;
      router.push(readHref(n), { scroll: false });
    },
    [chapterCount, chapterIndex, readHref, router],
  );

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
    const ratio = max > 0 ? Math.min(1, Math.max(0, el.scrollTop / max)) : 1;
    const pct = Math.min(100, ((chapterIndex + ratio) / chapterCount) * 100);
    progressRef.current = { chapterIndex, scrollRatio: ratio, percent: pct };
    setPercent(pct);
    schedulePatch();
  }, [chapterIndex, chapterCount, schedulePatch, showOriginalPdf]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || showOriginalPdf) return;
    let uiTick = 0;
    const onScroll = () => {
      const top = el.scrollTop;
      const last = lastScrollTopRef.current;
      if (top < 64) setChromeVisible(true);
      else if (top > last + 4) setChromeVisible(false);
      else if (top < last - 4) setChromeVisible(true);
      lastScrollTopRef.current = top;
      setMarkPopover(null);
      const now = Date.now();
      if (now - uiTick > 200) {
        uiTick = now;
        updateProgress();
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [updateProgress, showOriginalPdf]);

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

  // Restore the reading position whenever the text container (re)mounts for
  // the SAME chapter — first mount restores the server-saved position, and a
  // PDF 原文/文本 round-trip restores the freshest in-session position instead
  // of slamming to top and persisting ratio 0. Only a real chapter change
  // scrolls to the top.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || showOriginalPdf) return;
    const sameChapter = lastChapterRef.current === chapterIndex;
    const savedRatio = sameChapter
      ? progressRef.current.scrollRatio
      : progress && progress.chapterIndex === chapterIndex
        ? progress.scrollRatio
        : 0;
    lastChapterRef.current = chapterIndex;
    requestAnimationFrame(() => {
      el.scrollTop = savedRatio > 0 ? savedRatio * Math.max(0, el.scrollHeight - el.clientHeight) : 0;
      lastScrollTopRef.current = el.scrollTop;
      setChromeVisible(true);
      updateProgress();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterIndex, showOriginalPdf]);

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
      const t = e.target as HTMLElement | null;
      const inField = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.key === 'Escape') {
        // CJK IME users press Escape to cancel a composition (keyCode 229), and
        // Escape inside a field should only leave the field — never slam the
        // whole drawer shut mid-typing.
        if (e.isComposing || e.keyCode === 229 || inField) return;
        if (typographyOpen) setTypographyOpen(false);
        else if (markPopover) setMarkPopover(null);
        else if (drawer) setDrawer(null);
        return;
      }
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (inField || drawer || markPopover || typographyOpen) return;
      if (e.key === 'ArrowLeft') goChapter(chapterIndex - 1);
      else if (e.key === 'ArrowRight') goChapter(chapterIndex + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [typographyOpen, markPopover, drawer, goChapter, chapterIndex]);

  // ── highlights ────────────────────────────────────────────────────────

  useEffect(() => setChapterHighlights(highlights), [highlights]);

  useEffect(() => {
    const article = articleRef.current;
    if (!article || showOriginalPdf) return;
    clearHighlights(article);
    applyHighlights(
      article,
      chapterHighlights.filter((h) => h.chapterIndex === chapterIndex),
    );
  }, [chapterHighlights, chapter?.html, chapterIndex, showOriginalPdf]);

  const flashMark = useCallback((id: string): boolean => {
    const article = articleRef.current;
    if (!article) return false;
    const marks = article.querySelectorAll(`mark[data-hl-id="${esc(id)}"]`);
    if (marks.length === 0) return false;
    (marks[0] as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
    marks.forEach((m) => m.classList.add('reader-hl-flash'));
    window.setTimeout(() => marks.forEach((m) => m.classList.remove('reader-hl-flash')), 2400);
    return true;
  }, []);

  // ?hl= deep link: scroll to the mark and flash it (once per id). On a PDF
  // that opened in 原文 view the article isn't mounted — the showOriginalPdf
  // dep retries when the user switches to 文本.
  useEffect(() => {
    if (!focusHighlightId || flashedRef.current === focusHighlightId || showOriginalPdf) return;
    const t = window.setTimeout(() => {
      if (flashMark(focusHighlightId)) flashedRef.current = focusHighlightId;
    }, 180);
    return () => window.clearTimeout(t);
  }, [focusHighlightId, chapter?.html, chapterHighlights, flashMark, showOriginalPdf]);

  // Cross-chapter citation jump left in sessionStorage by the chat panel.
  useEffect(() => {
    if (showOriginalPdf) return;
    let jump: { chapterIndex: number; charStart: number; snippet: string } | null = null;
    try {
      const raw = sessionStorage.getItem(PENDING_JUMP_KEY);
      if (raw) jump = JSON.parse(raw);
    } catch {
      jump = null;
    }
    if (!jump || jump.chapterIndex !== chapterIndex) return;
    try {
      sessionStorage.removeItem(PENDING_JUMP_KEY);
    } catch {
      /* ignore */
    }
    const { snippet, charStart } = jump;
    const t = window.setTimeout(() => {
      const article = articleRef.current;
      if (article && typeof snippet === 'string') flashQuote(article, snippet, charStart ?? 0);
    }, 220);
    return () => window.clearTimeout(t);
  }, [chapterIndex, chapter?.html, showOriginalPdf]);

  const resyncChapterHighlights = useCallback(async () => {
    try {
      const res = await fetch(`/api/library/docs/${doc.id}/highlights?chapter=${chapterIndex}`);
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        const list = (data.highlights ?? data.items ?? []) as HighlightItem[];
        if (Array.isArray(list)) setChapterHighlights(list);
      }
    } catch {
      /* keep optimistic state */
    }
    setHlVersion((v) => v + 1);
  }, [doc.id, chapterIndex]);

  async function createHighlight(payload: SelectionPayload, color: HighlightColor, openNote: boolean) {
    const tempId = `temp-${Date.now()}`;
    const optimistic: HighlightItem = {
      id: tempId,
      chapterIndex,
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
        body: JSON.stringify({ chapterIndex, ...payload, color }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setChapterHighlights((prev) => prev.filter((h) => h.id !== tempId));
        pushToast(
          'error',
          data?.error === 'too_many'
            ? '这篇文档的高亮已达上限'
            : data?.error === 'rate_limited'
              ? '操作过于频繁，稍后再试'
              : '高亮保存失败',
        );
        return;
      }
      const saved = (data?.highlight ?? data) as { id?: unknown } | null;
      const realId = saved && typeof saved.id === 'string' ? saved.id : null;
      if (realId) {
        setChapterHighlights((prev) => prev.map((h) => (h.id === tempId ? { ...h, id: realId } : h)));
        setHlVersion((v) => v + 1);
        if (openNote) {
          setDrawerNoteId(realId);
          setDrawer('highlights');
        }
      } else {
        // Unexpected response shape — resync from the server instead of guessing.
        setChapterHighlights((prev) => prev.filter((h) => h.id !== tempId));
        void resyncChapterHighlights();
      }
    } catch {
      setChapterHighlights((prev) => prev.filter((h) => h.id !== tempId));
      pushToast('error', '网络错误，高亮未保存');
    }
  }

  async function recolor(id: string, color: HighlightColor) {
    setMarkPopover(null);
    const article = articleRef.current;
    if (article) recolorHighlight(article, id, color);
    setChapterHighlights((prev) => prev.map((h) => (h.id === id ? { ...h, color } : h)));
    try {
      const res = await fetch(`/api/library/docs/${doc.id}/highlights/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ color }),
      });
      if (!res.ok) {
        pushToast('error', '修改失败');
        void resyncChapterHighlights();
      } else {
        setHlVersion((v) => v + 1);
      }
    } catch {
      pushToast('error', '网络错误，修改未保存');
      void resyncChapterHighlights();
    }
  }

  async function removeHighlight(id: string) {
    setMarkPopover(null);
    const article = articleRef.current;
    if (article) removeHighlightMarks(article, id);
    setChapterHighlights((prev) => prev.filter((h) => h.id !== id));
    try {
      const res = await fetch(`/api/library/docs/${doc.id}/highlights/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        pushToast('error', '删除失败');
        void resyncChapterHighlights();
      } else {
        setHlVersion((v) => v + 1);
      }
    } catch {
      pushToast('error', '网络错误，删除失败');
      void resyncChapterHighlights();
    }
  }

  function onArticleClick(e: React.MouseEvent) {
    const mark = (e.target as HTMLElement).closest?.('mark[data-hl-id]') as HTMLElement | null;
    if (!mark || !mark.dataset.hlId || mark.dataset.hlId.startsWith('temp-')) {
      setMarkPopover(null);
      return;
    }
    const rect = mark.getBoundingClientRect();
    setMarkPopover({
      id: mark.dataset.hlId,
      top: rect.bottom + 10,
      left: rect.left + rect.width / 2,
    });
  }

  // ── chat wiring ───────────────────────────────────────────────────────

  const handleAskAi = useCallback((quote: string) => {
    setChatPrefill({ text: `这段话是什么意思：“${quote.slice(0, 200)}”`, nonce: Date.now() });
    setDrawer('chat');
  }, []);

  const handleCitationJump = useCallback(
    (citation: Citation) => {
      if (citation.chapterIndex === chapterIndex && !showOriginalPdf) {
        const article = articleRef.current;
        if (article) flashQuote(article, citation.snippet, citation.charStart);
        return;
      }
      try {
        sessionStorage.setItem(
          PENDING_JUMP_KEY,
          JSON.stringify({
            chapterIndex: citation.chapterIndex,
            charStart: citation.charStart,
            snippet: citation.snippet,
            chunkKey: citation.key,
          }),
        );
      } catch {
        /* ignore */
      }
      if (showOriginalPdf) setPdfView('text');
      router.push(readHref(citation.chapterIndex), { scroll: false });
    },
    [chapterIndex, readHref, router, showOriginalPdf],
  );

  // ── render ────────────────────────────────────────────────────────────

  const chapterLabel =
    chapterCount > 1
      ? `第 ${chapterIndex + 1}/${chapterCount} 章${chapter?.title ? ` · ${chapter.title}` : ''}`
      : (doc.siteName ?? doc.author ?? null);

  return (
    <div
      className="reader-root fixed inset-0 z-50 overflow-hidden"
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
      <ReaderChrome
        visible={chromeVisible || showOriginalPdf}
        backHref={`/library/${doc.slug}`}
        title={doc.title}
        chapterLabel={chapterLabel}
        sourceUrl={doc.sourceUrl}
        percent={percent}
        activeDrawer={drawer}
        onToggleDrawer={(d) => setDrawer((prev) => (prev === d ? null : d))}
        typographyOpen={typographyOpen}
        onToggleTypography={() => setTypographyOpen((v) => !v)}
        onCloseTypography={() => setTypographyOpen(false)}
        prefs={prefs}
        onPrefsChange={updatePrefs}
        pdfMode={
          doc.format === 'pdf' && doc.fileUrl
            ? { view: pdfView, onChange: setPdfView }
            : null
        }
      />

      {showOriginalPdf ? (
        <iframe
          src={withBasePath(doc.fileUrl)}
          title={doc.title}
          className="absolute inset-0 h-full w-full border-0 pt-12"
        />
      ) : (
        <div ref={scrollRef} className="h-full overflow-y-auto overscroll-contain">
          {chapter ? (
            <ReaderContent
              ref={articleRef}
              html={chapter.html}
              docTitle={doc.title}
              author={doc.author}
              siteName={doc.siteName}
              chapterIndex={chapterIndex}
              chapterTitle={chapter.title}
              chapterCount={chapterCount}
              readHref={readHref}
              onArticleClick={onArticleClick}
            />
          ) : (
            <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 pt-40 text-center">
              <FileText className="r-muted h-8 w-8" />
              <p className="text-sm font-medium">该文档暂无可阅读的文本内容</p>
              {doc.format === 'pdf' && doc.fileUrl && (
                <button
                  type="button"
                  onClick={() => setPdfView('original')}
                  className="rborder h-9 rounded-lg border px-4 text-sm font-medium transition hover:bg-[var(--reader-hover)]"
                >
                  查看原文件
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {!showOriginalPdf && (
        <SelectionMenu
          articleRef={articleRef}
          onHighlight={(payload, color) => void createHighlight(payload, color, false)}
          onNote={(payload) => void createHighlight(payload, 'yellow', true)}
          onAskAi={handleAskAi}
        />
      )}

      {markPopover && (
        <MarkPopover
          top={markPopover.top}
          left={markPopover.left}
          currentColor={chapterHighlights.find((h) => h.id === markPopover.id)?.color ?? 'yellow'}
          onRecolor={(color) => void recolor(markPopover.id, color)}
          onNote={() => {
            setDrawerNoteId(markPopover.id);
            setDrawer('highlights');
            setMarkPopover(null);
          }}
          onDelete={() => void removeHighlight(markPopover.id)}
          onClose={() => setMarkPopover(null)}
        />
      )}

      <TocDrawer
        open={drawer === 'toc'}
        onClose={() => setDrawer(null)}
        toc={toc}
        current={chapterIndex}
        onSelect={(n) => {
          setDrawer(null);
          goChapter(n);
        }}
      />

      <HighlightsDrawer
        open={drawer === 'highlights'}
        onClose={() => {
          setDrawer(null);
          setDrawerNoteId(null);
        }}
        docId={doc.id}
        toc={toc}
        version={hlVersion}
        editNoteId={drawerNoteId}
        onJump={(hl) => {
          setDrawer(null);
          setDrawerNoteId(null);
          if (hl.chapterIndex === chapterIndex && !showOriginalPdf) {
            flashMark(hl.id);
          } else {
            if (showOriginalPdf) setPdfView('text');
            flashedRef.current = null;
            router.push(`${readHref(hl.chapterIndex)}&hl=${hl.id}`, { scroll: false });
          }
        }}
        onMutated={(id, patch) => {
          if (patch === null) {
            const article = articleRef.current;
            if (article) removeHighlightMarks(article, id);
            setChapterHighlights((prev) => prev.filter((h) => h.id !== id));
          } else {
            if (patch.color) {
              const article = articleRef.current;
              if (article) recolorHighlight(article, id, patch.color);
            }
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
        }}
      />

      <ReaderChatPanel
        open={drawer === 'chat'}
        onClose={() => setDrawer(null)}
        docId={doc.id}
        aiIndexState={doc.aiIndexState}
        questions={doc.aiOverview?.questions ?? []}
        prefill={chatPrefill}
        onCitationJump={handleCitationJump}
      />
    </div>
  );
}
