'use client';

// 原版 PDF 渲染器 — pdf.js canvas + official TextLayer. The text layer lives in
// OUR DOM (pdf.js sets each span's position + the container's --scale-factor via
// setLayerDimensions), so selection / 高亮 / 批注 / 社区标注 / AI 引用跳转 / 翻译
// all work on a pixel-faithful render. Internal outline/link annotations become
// clickable. Pages are virtualized (visible ±2). Zoom keeps the reading spot.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Maximize, Minus, Plus } from 'lucide-react';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { withBasePath } from '@/lib/base-path';
import { applyCommunityMarks, applyHighlights, clearCommunityMarks, clearHighlights, flashQuote } from './anchoring';
import { SelectionMenu, type HighlightColor, type SelectionContext, type SelectionPayload } from './SelectionMenu';
import type { HighlightItem } from './NotesPanel';
import type { CommunityNote } from './community-types';
import type { TocEntry } from './TocPanel';

type PdfJs = typeof import('pdfjs-dist');

export interface PdfViewHandle {
  jumpToPage: (page: number) => void;
  jumpToChapter: (chapterIndex: number) => void;
  jumpToQuote: (chapterIndex: number, quote: string, charStart: number) => void;
}

interface Props {
  fileUrl: string;
  scrollRef: React.RefObject<HTMLDivElement>;
  toc: TocEntry[];
  highlights: HighlightItem[];
  communityNotes: CommunityNote[];
  initialPage: number;
  onVisiblePage: (page: number, pageCount: number, inPageRatio: number) => void;
  onHighlight: (payload: SelectionPayload, color: HighlightColor) => void;
  onNote: (payload: SelectionPayload) => void;
  onAskAi: (quote: string) => void;
  onTranslate: (text: string, anchor: { top: number; left: number }) => void;
  onMarkClick: (id: string, rect: DOMRect) => void;
  onCommunityMarkClick: (noteId: string) => void;
}

const PAGE_GAP = 16;
const RENDER_AHEAD = 2;
const MIN_SCALE = 0.4;
const MAX_SCALE = 3;
// Cap the default reading width so a wide window doesn't blow a letter page up
// to 2.5×; the user can still zoom past this manually.
const COMFORT_WIDTH = 860;
const SIDE_PAD = 48;

export const PdfView = forwardRef<PdfViewHandle, Props>(function PdfView(
  {
    fileUrl,
    scrollRef,
    toc,
    highlights,
    communityNotes,
    initialPage,
    onVisiblePage,
    onHighlight,
    onNote,
    onAskAi,
    onTranslate,
    onMarkClick,
    onCommunityMarkClick,
  },
  handleRef,
) {
  const t = useTranslations('reader');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState<number | null>(null);
  const [renderEpoch, setRenderEpoch] = useState(0);
  const [visibleRange, setVisibleRange] = useState<[number, number]>([0, RENDER_AHEAD]);
  const [currentPage, setCurrentPage] = useState(0);

  const pdfjsRef = useRef<PdfJs | null>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const baseSizeRef = useRef<{ width: number; height: number }>({ width: 612, height: 792 });
  const pageElsRef = useRef(new Map<number, HTMLDivElement>());
  const textLayersRef = useRef(new Map<number, HTMLElement>());
  const renderedRef = useRef(new Map<number, number>());
  const renderingRef = useRef(new Set<number>());
  const restoredRef = useRef(false);
  const userZoomedRef = useRef(false);
  const pendingFlashRef = useRef<{ pages: number[]; quote: string; charStart: number } | null>(null);
  const destPageCacheRef = useRef(new Map<string, number>());

  const chapterForPage = useCallback(
    (page: number): number => {
      for (const c of toc) {
        if (c.pageStart !== null && c.pageEnd !== null && page >= c.pageStart && page <= c.pageEnd) {
          return c.chapterIndex;
        }
      }
      return toc[0]?.chapterIndex ?? 0;
    },
    [toc],
  );

  const pagesForChapter = useCallback(
    (chapterIndex: number): number[] => {
      const c = toc.find((entry) => entry.chapterIndex === chapterIndex);
      if (!c || c.pageStart === null || c.pageEnd === null) return [];
      const out: number[] = [];
      for (let p = c.pageStart; p <= c.pageEnd; p++) out.push(p);
      return out;
    },
    [toc],
  );

  const firstPageForChapter = useCallback(
    (chapterIndex: number): number => {
      const c = toc.find((entry) => entry.chapterIndex === chapterIndex);
      if (c && c.pageStart !== null) return c.pageStart;
      const total = Math.max(1, toc.length);
      return Math.min(pageCount - 1, Math.max(0, Math.round((chapterIndex / total) * pageCount)));
    },
    [toc, pageCount],
  );

  const pageHeight = useCallback((s: number) => baseSizeRef.current.height * s + PAGE_GAP, []);

  const fitScale = useCallback((): number => {
    const el = scrollRef.current;
    const avail = el ? el.clientWidth - SIDE_PAD : 800;
    const w = Math.min(avail, COMFORT_WIDTH);
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, w / baseSizeRef.current.width));
  }, [scrollRef]);

  // ── document load ─────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = withBasePath('/pdfjs/pdf.worker.min.mjs');
        const doc = await pdfjs.getDocument({
          url: withBasePath(fileUrl),
          cMapUrl: withBasePath('/pdfjs/cmaps/'),
          cMapPacked: true,
          standardFontDataUrl: withBasePath('/pdfjs/standard_fonts/'),
          withCredentials: true,
        }).promise;
        if (cancelled) return;
        const first = await doc.getPage(1);
        const vp = first.getViewport({ scale: 1 });
        baseSizeRef.current = { width: vp.width, height: vp.height };
        pdfjsRef.current = pdfjs;
        docRef.current = doc;
        setPageCount(doc.numPages);
        setStatus('ready');
      } catch (e) {
        console.error('[library] pdf load failed', e);
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
      const d = docRef.current as unknown as { destroy?: () => Promise<void> } | null;
      void d?.destroy?.().catch(() => undefined);
      docRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl]);

  // Initial fit once the container has a width; re-fit on resize UNLESS the user
  // has manually zoomed (their choice wins).
  useEffect(() => {
    if (status !== 'ready') return;
    const el = scrollRef.current;
    if (!el) return;
    if (scale === null) setScale(fitScale());
    const ro = new ResizeObserver(() => {
      if (userZoomedRef.current) return;
      const next = fitScale();
      setScale((s) => (s !== null && Math.abs(s - next) < 0.01 ? s : next));
      renderedRef.current.clear();
      setRenderEpoch((n) => n + 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, fitScale]);

  // Zoom keeps the current reading spot: record the anchor page + in-page ratio
  // against the OLD scale, then restore scrollTop against the new one.
  const applyZoom = useCallback(
    (next: number | 'fit') => {
      const el = scrollRef.current;
      const old = scale ?? 1;
      const value =
        next === 'fit' ? fitScale() : Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(next.toFixed(2))));
      if (next !== 'fit') userZoomedRef.current = true;
      else userZoomedRef.current = false;
      if (Math.abs(value - old) < 0.005) return;

      let anchorPage = 0;
      let inPage = 0;
      if (el) {
        const oldPh = pageHeight(old);
        anchorPage = Math.floor(el.scrollTop / oldPh);
        inPage = (el.scrollTop - anchorPage * oldPh) / oldPh;
      }
      renderedRef.current.clear();
      setScale(value);
      setRenderEpoch((n) => n + 1);
      requestAnimationFrame(() => {
        const el2 = scrollRef.current;
        if (!el2) return;
        const newPh = pageHeight(value);
        el2.scrollTop = anchorPage * newPh + inPage * newPh;
      });
    },
    [scale, fitScale, pageHeight, scrollRef],
  );

  // ── virtualization: track visible pages from scroll ───────────────────
  useEffect(() => {
    if (status !== 'ready' || scale === null) return;
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const ph = pageHeight(scale);
      const anchor = el.scrollTop + el.clientHeight * 0.35;
      const current = Math.min(pageCount - 1, Math.max(0, Math.floor(anchor / ph)));
      const ratio = Math.min(1, Math.max(0, (anchor - current * ph) / Math.max(1, ph - PAGE_GAP)));
      onVisiblePage(current, pageCount, ratio);
      setCurrentPage(current);
      const first = Math.max(0, Math.floor(el.scrollTop / ph) - RENDER_AHEAD);
      const last = Math.min(pageCount - 1, Math.ceil((el.scrollTop + el.clientHeight) / ph) + RENDER_AHEAD);
      setVisibleRange((prev) => (prev[0] === first && prev[1] === last ? prev : [first, last]));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    return () => el.removeEventListener('scroll', update);
  }, [status, scale, pageCount, pageHeight, onVisiblePage, scrollRef]);

  // Restore initial position once (after the first real scale is set).
  useEffect(() => {
    if (status !== 'ready' || scale === null || restoredRef.current) return;
    restoredRef.current = true;
    const el = scrollRef.current;
    if (!el || initialPage <= 0) return;
    requestAnimationFrame(() => {
      el.scrollTop = initialPage * pageHeight(scale);
    });
  }, [status, scale, initialPage, pageHeight, scrollRef]);

  // ── marks on rendered text layers ─────────────────────────────────────
  const paintPage = useCallback(
    (page: number) => {
      const layer = textLayersRef.current.get(page);
      if (!layer) return;
      const ci = chapterForPage(page);
      clearHighlights(layer);
      clearCommunityMarks(layer);
      const own = highlights.filter((h) => h.chapterIndex === ci);
      if (own.length > 0) applyHighlights(layer, own);
      const community = communityNotes.filter((n) => n.chapterIndex === ci);
      if (community.length > 0) applyCommunityMarks(layer, community);
    },
    [chapterForPage, highlights, communityNotes],
  );
  const paintRef = useRef(paintPage);
  paintRef.current = paintPage;
  const markSig =
    highlights.map((h) => `${h.id}:${h.color}`).join(',') + '|' + communityNotes.map((n) => n.id).join(',');
  useEffect(() => {
    for (const page of textLayersRef.current.keys()) paintRef.current(page);
  }, [markSig]);

  // ── internal link annotations → clickable page jumps ──────────────────
  const jumpToPageRef = useRef<(p: number) => void>(() => {});

  const renderAnnotations = useCallback(
    async (pdfPage: PDFPageProxy, host: HTMLElement, viewport: import('pdfjs-dist').PageViewport) => {
      const doc = docRef.current;
      if (!doc) return;
      let annots: Awaited<ReturnType<PDFPageProxy['getAnnotations']>>;
      try {
        annots = await pdfPage.getAnnotations();
      } catch {
        return;
      }
      const layer = document.createElement('div');
      layer.className = 'pdf-annots';
      for (const a of annots) {
        const anyA = a as unknown as {
          subtype?: string;
          rect?: number[];
          dest?: unknown;
          url?: string;
        };
        if (anyA.subtype !== 'Link' || !anyA.rect || anyA.rect.length < 4) continue;
        const [ax1, ay1, ax2, ay2] = anyA.rect;
        const [vx1, vy1] = viewport.convertToViewportPoint(ax1, ay1);
        const [vx2, vy2] = viewport.convertToViewportPoint(ax2, ay2);
        const left = Math.min(vx1, vx2);
        const top = Math.min(vy1, vy2);
        const w = Math.abs(vx2 - vx1);
        const h = Math.abs(vy2 - vy1);
        const el = document.createElement(anyA.url ? 'a' : 'button');
        el.className = 'pdf-annot-link';
        el.style.cssText = `left:${left}px;top:${top}px;width:${w}px;height:${h}px`;
        if (anyA.url && typeof anyA.url === 'string') {
          (el as HTMLAnchorElement).href = anyA.url;
          (el as HTMLAnchorElement).target = '_blank';
          (el as HTMLAnchorElement).rel = 'noopener noreferrer nofollow';
        } else if (anyA.dest !== undefined && anyA.dest !== null) {
          const dest = anyA.dest;
          el.addEventListener('click', (ev) => {
            ev.preventDefault();
            void (async () => {
              try {
                const explicit =
                  typeof dest === 'string' ? await doc.getDestination(dest) : (dest as unknown[]);
                if (!Array.isArray(explicit) || explicit.length === 0) return;
                const ref = explicit[0];
                const key = JSON.stringify(ref);
                let pageIndex = destPageCacheRef.current.get(key);
                if (pageIndex === undefined) {
                  pageIndex = await doc.getPageIndex(ref as Parameters<PDFDocumentProxy['getPageIndex']>[0]);
                  destPageCacheRef.current.set(key, pageIndex);
                }
                jumpToPageRef.current(pageIndex);
              } catch {
                /* unresolvable link — ignore */
              }
            })();
          });
        } else {
          continue;
        }
        layer.appendChild(el);
      }
      if (layer.childElementCount > 0) host.appendChild(layer);
    },
    [],
  );

  // ── page rendering ────────────────────────────────────────────────────
  const renderPage = useCallback(
    async (page: number, epoch: number, currentScale: number) => {
      const doc = docRef.current;
      const pdfjs = pdfjsRef.current;
      const host = pageElsRef.current.get(page);
      if (!doc || !pdfjs || !host) return;
      if (renderedRef.current.get(page) === epoch || renderingRef.current.has(page)) return;
      renderingRef.current.add(page);
      try {
        const pdfPage = await doc.getPage(page + 1);
        const viewport = pdfPage.getViewport({ scale: currentScale });
        const dpr = Math.min(3, window.devicePixelRatio || 1);

        host.replaceChildren();

        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.className = 'pdf-canvas';
        host.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        await pdfPage.render({
          canvas: null,
          canvasContext: ctx,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        }).promise;

        // pdf.js TextLayer.render() sets the container's --scale-factor and
        // size via setLayerDimensions — do NOT set those ourselves (that was
        // the "选中很乱" misalignment).
        const textDiv = document.createElement('div');
        textDiv.className = 'textLayer';
        host.appendChild(textDiv);
        const textLayer = new pdfjs.TextLayer({
          textContentSource: await pdfPage.getTextContent(),
          container: textDiv,
          viewport,
        });
        await textLayer.render();

        textLayersRef.current.set(page, textDiv);
        renderedRef.current.set(page, epoch);
        paintRef.current(page);

        void renderAnnotations(pdfPage, host, viewport);

        const pending = pendingFlashRef.current;
        if (pending && pending.pages.includes(page)) {
          if (flashQuote(textDiv, pending.quote, pending.charStart)) pendingFlashRef.current = null;
        }
      } catch (e) {
        if (!(e instanceof Error && e.name === 'RenderingCancelledException')) {
          console.error('[library] pdf page render failed', page, e);
        }
      } finally {
        renderingRef.current.delete(page);
      }
    },
    [renderAnnotations],
  );

  useEffect(() => {
    if (status !== 'ready' || scale === null) return;
    const [first, last] = visibleRange;
    for (let p = first; p <= last; p++) void renderPage(p, renderEpoch, scale);
    for (const [p, host] of pageElsRef.current) {
      if (p >= first - 4 && p <= last + 4) continue;
      if (renderedRef.current.has(p)) {
        host.replaceChildren();
        renderedRef.current.delete(p);
        textLayersRef.current.delete(p);
      }
    }
  }, [status, scale, visibleRange, renderEpoch, renderPage]);

  // ── selection & clicks ────────────────────────────────────────────────
  const getSelectionContext = useCallback(
    (node: Node): SelectionContext | null => {
      for (const [page, layer] of textLayersRef.current) {
        if (layer.contains(node)) return { root: layer, chapterIndex: chapterForPage(page) };
      }
      return null;
    },
    [chapterForPage],
  );

  function onClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    const community = target.closest?.('mark[data-chl-id]') as HTMLElement | null;
    if (community?.dataset.chlId) {
      onCommunityMarkClick(community.dataset.chlId);
      return;
    }
    const mark = target.closest?.('mark[data-hl-id]') as HTMLElement | null;
    if (mark?.dataset.hlId && !mark.dataset.hlId.startsWith('temp-')) {
      onMarkClick(mark.dataset.hlId, mark.getBoundingClientRect());
    }
  }

  const jumpToPage = useCallback(
    (page: number) => {
      const el = scrollRef.current;
      if (!el || scale === null) return;
      el.scrollTo({ top: Math.max(0, page * pageHeight(scale) - 8), behavior: 'smooth' });
    },
    [pageHeight, scale, scrollRef],
  );
  jumpToPageRef.current = jumpToPage;

  useImperativeHandle(
    handleRef,
    (): PdfViewHandle => ({
      jumpToPage,
      jumpToChapter(chapterIndex) {
        jumpToPage(firstPageForChapter(chapterIndex));
      },
      jumpToQuote(chapterIndex, quote, charStart) {
        for (const [, layer] of textLayersRef.current) {
          if (flashQuote(layer, quote, charStart)) return;
        }
        const pages = pagesForChapter(chapterIndex);
        const target = pages.length > 0 ? pages : [firstPageForChapter(chapterIndex)];
        const widened =
          pages.length > 0
            ? target
            : [Math.max(0, target[0] - 1), target[0], Math.min(pageCount - 1, target[0] + 1)];
        pendingFlashRef.current = { pages: widened, quote, charStart };
        jumpToPage(target[0]);
        window.setTimeout(() => {
          const pending = pendingFlashRef.current;
          if (!pending) return;
          for (const p of pending.pages) {
            const layer = textLayersRef.current.get(p);
            if (layer && flashQuote(layer, pending.quote, pending.charStart)) break;
          }
          pendingFlashRef.current = null;
        }, 2500);
      },
    }),
    [jumpToPage, firstPageForChapter, pagesForChapter, pageCount],
  );

  const dims = useMemo(() => {
    if (scale === null) return null;
    return { width: baseSizeRef.current.width * scale, height: baseSizeRef.current.height * scale };
  }, [scale]);

  if (status === 'error') {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 pt-40 text-center">
        <p className="text-sm font-medium">{t('pdf_render_failed')}</p>
        <p className="r-muted text-xs">{t('pdf_render_failed_desc')}</p>
        <a
          href={withBasePath(fileUrl)}
          target="_blank"
          rel="noopener noreferrer"
          className="rborder h-9 rounded-lg border px-4 text-sm font-medium leading-9 transition hover:bg-[var(--reader-hover)]"
        >
          {t('open_original_file')}
        </a>
      </div>
    );
  }

  if (status === 'loading' || scale === null || !dims) {
    return (
      <div className="flex justify-center pt-40">
        <Loader2 className="h-6 w-6 animate-spin text-accent-500" />
      </div>
    );
  }

  return (
    <div className="relative pb-16 pt-4" onClick={onClick}>
      {Array.from({ length: pageCount }, (_, p) => (
        <div key={p} className="mx-auto" style={{ width: dims.width, height: dims.height, marginBottom: PAGE_GAP }}>
          <div
            ref={(el) => {
              if (el) pageElsRef.current.set(p, el);
              else {
                pageElsRef.current.delete(p);
                textLayersRef.current.delete(p);
                renderedRef.current.delete(p);
              }
            }}
            className="pdf-page relative h-full w-full"
          />
        </div>
      ))}

      <SelectionMenu
        getContext={getSelectionContext}
        onHighlight={onHighlight}
        onNote={onNote}
        onAskAi={onAskAi}
        onTranslate={onTranslate}
      />

      <div className="reader-panel rborder fixed bottom-5 right-5 z-30 flex items-center gap-0.5 rounded-xl border p-1 shadow-lg">
        <PageJump current={currentPage} total={pageCount} onJump={jumpToPage} />
        <span className="rborder mx-1 h-5 w-px border-l" />
        <button
          type="button"
          aria-label={t('zoom_out')}
          onClick={() => applyZoom(scale - 0.15)}
          className="r-muted grid h-8 w-8 place-items-center rounded-lg transition hover:bg-[var(--reader-hover)]"
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="w-12 text-center font-mono text-xs tabular-nums">{Math.round(scale * 100)}%</span>
        <button
          type="button"
          aria-label={t('zoom_in')}
          onClick={() => applyZoom(scale + 0.15)}
          className="r-muted grid h-8 w-8 place-items-center rounded-lg transition hover:bg-[var(--reader-hover)]"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label={t('fit_width')}
          title={t('fit_width')}
          onClick={() => applyZoom('fit')}
          className="r-muted grid h-8 w-8 place-items-center rounded-lg transition hover:bg-[var(--reader-hover)]"
        >
          <Maximize className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
});

/** 第 [n] / N 页 jump box — type a page and Enter (or blur) to jump. */
function PageJump({
  current,
  total,
  onJump,
}: {
  current: number;
  total: number;
  onJump: (page: number) => void;
}) {
  const t = useTranslations('reader');
  const [value, setValue] = useState(String(current + 1));
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setValue(String(current + 1));
  }, [current]);

  const commit = () => {
    const n = Number.parseInt(value, 10);
    if (Number.isFinite(n) && n >= 1 && n <= total) onJump(n - 1);
    else setValue(String(current + 1));
  };

  return (
    <div className="flex items-center gap-1 pl-1 text-xs">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ''))}
        onFocus={(e) => {
          focusedRef.current = true;
          e.target.select();
        }}
        onBlur={() => {
          focusedRef.current = false;
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        aria-label={t('page_number')}
        className="rborder h-7 w-10 rounded-md border bg-transparent text-center font-mono tabular-nums outline-none focus:border-accent-500"
      />
      <span className="r-muted whitespace-nowrap">/ {total}</span>
    </div>
  );
}
