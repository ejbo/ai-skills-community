'use client';

// 封面裁切编辑器 — the reusable crop editor behind the shared cover contract
// (lib/media/cover-pos.ts). Born as 投票作品的 PosterCropEditor; extracted so the
// long-video form and the 技术专区 composer edit covers with the SAME gesture and
// store the SAME three-state value, instead of each growing its own copy.
//
// It shows the WHOLE image with a draggable frame of the chosen aspect on top:
// outside the frame is dimmed (= never shown), inside is what the surface will
// display. Purely controlled — `aspect` / `pos` live in the host (a form's local
// state, a PATCH draft), and nothing here touches the network.
//
//   pos ''         居中裁切 (frame starts centred; dragging turns it into 'x% y%')
//   pos 'x% y%'    the frame's position, as CSS object-position percentages
//   pos 'contain'  完整显示 — no frame, the whole image is shown
//
// The object-position algebra: with the image contain-fitted to (dispW × dispH)
// and the frame (frameW × frameH) inside it, p% = frameOffset / (disp − frame) · 100
// on the one axis that has slack. `natural` MUST reset when imageUrl swaps: stale
// geometry from the previous image would save a wrong crop during the load gap.
//
// Keyboard: the frame is focusable; arrows nudge 2 % (Shift 10 %), Home/End jump
// to the edges of the axis that has slack.

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Move } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { withBasePath } from '@/lib/base-path';
import { COVER_POS_CONTAIN, coverObjectPosition, coverPosPercent, formatCoverPos, type CoverAspect } from '@/lib/media/cover-pos';

export interface CoverCropLabels {
  landscape: string;
  portrait: string;
  modeCrop: string;
  modeFull: string;
  visibleBadge: string;
  fullBadge: string;
  dragHint: string;
  fullHint: string;
  frameAria: string;
}

export interface CoverCropEditorProps {
  /** Stored root-relative url or a blob: url (withBasePath passes blob: through). */
  imageUrl: string;
  aspect: CoverAspect;
  pos: string;
  /** Width ÷ height of the frame for an aspect — the SAME function the surface's renderer uses. */
  ratioFor: (aspect: CoverAspect) => number;
  /** Omit to lock the aspect (no 横版/竖版 toggle). */
  onAspectChange?: (aspect: CoverAspect) => void;
  onPosChange: (pos: string) => void;
  /** Host strings; anything omitted falls back to the shared `ui.crop_*` messages. */
  labels?: Partial<CoverCropLabels>;
  /** Tallest the editing surface may get, px. */
  maxEditorHeight?: number;
  /** Extra content under the editor — typically the host's own "实际展示" previews. */
  children?: ReactNode;
  /** false hides the built-in single-frame preview (when the host renders richer ones in `children`). */
  framePreview?: boolean;
}

export function CoverCropEditor({
  imageUrl,
  aspect,
  pos,
  ratioFor,
  onAspectChange,
  onPosChange,
  labels,
  maxEditorHeight = 300,
  children,
  framePreview = true,
}: CoverCropEditorProps) {
  const t = useTranslations('ui');
  const L: CoverCropLabels = {
    landscape: labels?.landscape ?? t('crop_landscape'),
    portrait: labels?.portrait ?? t('crop_portrait'),
    modeCrop: labels?.modeCrop ?? t('crop_mode_crop'),
    modeFull: labels?.modeFull ?? t('crop_mode_full'),
    visibleBadge: labels?.visibleBadge ?? t('crop_visible_badge'),
    fullBadge: labels?.fullBadge ?? t('crop_full_badge'),
    dragHint: labels?.dragHint ?? t('crop_drag_hint'),
    fullHint: labels?.fullHint ?? t('crop_full_hint'),
    frameAria: labels?.frameAria ?? t('crop_frame_aria'),
  };

  const wrapRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [wrapWidth, setWrapWidth] = useState(0);
  const drag = useRef<{ startX: number; startY: number; left: number; top: number } | null>(null);

  const measure = useCallback(() => {
    setWrapWidth(wrapRef.current?.clientWidth ?? 0);
  }, []);
  useEffect(() => {
    measure();
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  // A swapped image invalidates the old natural size at once (see the header).
  useEffect(() => {
    setNatural(null);
  }, [imageUrl]);

  // Displayed (contain-fitted) image box inside the wrapper.
  let dispW = 0;
  let dispH = 0;
  if (natural && wrapWidth > 0) {
    const scale = Math.min(wrapWidth / natural.w, maxEditorHeight / natural.h);
    dispW = natural.w * scale;
    dispH = natural.h * scale;
  }
  // Frame = the largest box of the chosen aspect that fits inside the displayed image.
  const ratio = ratioFor(aspect);
  let frameW = 0;
  let frameH = 0;
  if (dispW > 0 && dispH > 0) {
    if (dispW / dispH > ratio) {
      frameH = dispH;
      frameW = dispH * ratio;
    } else {
      frameW = dispW;
      frameH = dispW / ratio;
    }
  }
  const freeX = dispW - frameW; // draggable slack per axis (one of them is ~0)
  const freeY = dispH - frameH;
  const cropping = pos !== COVER_POS_CONTAIN;
  const p = coverPosPercent(pos);
  const frameLeft = freeX > 0 ? (p.x / 100) * freeX : 0;
  const frameTop = freeY > 0 ? (p.y / 100) * freeY : 0;

  function posFromOffsets(left: number, top: number): string {
    return formatCoverPos(freeX > 0.5 ? (left / freeX) * 100 : 50, freeY > 0.5 ? (top / freeY) * 100 : 50);
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!cropping) return;
    drag.current = { startX: e.clientX, startY: e.clientY, left: frameLeft, top: frameTop };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const left = Math.max(0, Math.min(freeX, drag.current.left + (e.clientX - drag.current.startX)));
    const top = Math.max(0, Math.min(freeY, drag.current.top + (e.clientY - drag.current.startY)));
    onPosChange(posFromOffsets(left, top));
  }
  function onPointerUp() {
    drag.current = null;
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!cropping) return;
    const step = e.shiftKey ? 10 : 2;
    let { x, y } = p;
    if (e.key === 'ArrowLeft') x -= step;
    else if (e.key === 'ArrowRight') x += step;
    else if (e.key === 'ArrowUp') y -= step;
    else if (e.key === 'ArrowDown') y += step;
    else if (e.key === 'Home') (freeX > 0.5 ? (x = 0) : (y = 0));
    else if (e.key === 'End') (freeX > 0.5 ? (x = 100) : (y = 100));
    else return;
    e.preventDefault();
    onPosChange(formatCoverPos(freeX > 0.5 ? x : 50, freeY > 0.5 ? y : 50));
  }

  const segBtn = (active: boolean) =>
    `rounded-md px-2.5 py-1 text-xs font-medium transition ${
      active
        ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
        : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
    }`;
  const url = withBasePath(imageUrl);

  return (
    <div>
      {/* 版式 + 模式 */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {onAspectChange && (
          <div className="flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-800">
            <button type="button" aria-pressed={aspect === 'landscape'} onClick={() => onAspectChange('landscape')} className={segBtn(aspect === 'landscape')}>
              {L.landscape}
            </button>
            <button type="button" aria-pressed={aspect === 'portrait'} onClick={() => onAspectChange('portrait')} className={segBtn(aspect === 'portrait')}>
              {L.portrait}
            </button>
          </div>
        )}
        <div className="flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-800">
          <button type="button" aria-pressed={cropping} onClick={() => onPosChange('')} className={segBtn(cropping)}>
            {L.modeCrop}
          </button>
          <button type="button" aria-pressed={!cropping} onClick={() => onPosChange(COVER_POS_CONTAIN)} className={segBtn(!cropping)}>
            {L.modeFull}
          </button>
        </div>
      </div>

      {/* 全图 + 取景框（框外压暗 = 不会展示） */}
      <div ref={wrapRef} className="flex w-full justify-center">
        {dispW > 0 ? (
          <div className="relative touch-none select-none overflow-hidden rounded-lg bg-zinc-950" style={{ width: dispW, height: dispH }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- stored media url / blob: */}
            <img src={url} alt="" draggable={false} className="h-full w-full object-contain" />
            {cropping && (
              <div
                role="slider"
                tabIndex={0}
                aria-label={L.frameAria}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={freeX > 0.5 ? p.x : p.y}
                aria-valuetext={coverObjectPosition(pos)}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onKeyDown={onKeyDown}
                className="absolute cursor-move rounded-sm border-2 border-white/90 outline-none focus-visible:ring-2 focus-visible:ring-white"
                style={{ width: frameW, height: frameH, left: frameLeft, top: frameTop, boxShadow: '0 0 0 9999px rgba(0,0,0,0.62)' }}
              >
                <span className="pointer-events-none absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] text-white">
                  <Move className="h-3 w-3" aria-hidden />
                  {L.visibleBadge}
                </span>
              </div>
            )}
            {!cropping && (
              <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[10px] text-white">
                {L.fullBadge}
              </span>
            )}
          </div>
        ) : (
          <div className="flex h-40 w-full items-center justify-center text-xs text-muted">…</div>
        )}
      </div>
      {/* 隐藏的测量用 img（自然尺寸） */}
      {/* eslint-disable-next-line @next/next/no-img-element -- measuring copy */}
      <img
        src={url}
        alt=""
        className="hidden"
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth > 0) setNatural({ w: img.naturalWidth, h: img.naturalHeight });
          measure();
        }}
        onError={() => setNatural(null)}
      />

      {framePreview && (
        <div className="mt-3 flex items-end gap-3">
          <div
            className={`relative shrink-0 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800 ${aspect === 'portrait' ? 'w-24' : 'w-32'}`}
            style={{ aspectRatio: String(ratio) }}
          >
            {pos === COVER_POS_CONTAIN ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-md" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="relative h-full w-full object-contain" />
              </>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="" className="h-full w-full object-cover" style={{ objectPosition: coverObjectPosition(pos) }} />
            )}
          </div>
          <p className="pb-1 text-xs text-muted">{cropping ? L.dragHint : L.fullHint}</p>
        </div>
      )}
      {children}
    </div>
  );
}
