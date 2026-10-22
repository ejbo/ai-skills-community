'use client';

// Lightbox for the images INSIDE a zone post body. The events `ImageLightbox`
// is a trigger + overlay pair wrapped around one known thumbnail; a body has N
// images the markdown renderer knows nothing about, so this one is CONTROLLED:
// ZoneMarkdown's delegated click hands us `{ src, alt, rect }`, `onClose` hands
// it back. Three rules, each load-bearing:
//   - it FLIPs from the clicked <img>'s rect to its resting centred box
//     (measure the resting box in a layout effect, mount the motion element
//     with that delta as `initial` — React flushes the layout-effect state
//     synchronously, so no frame ever shows the un-transformed image);
//   - it portals to `usePortalHost()` (the fullscreened element when a file
//     preview is fullscreen, else body) so it is never trapped under the top
//     layer or a `card-hover` transform;
//   - it is a real dialog (`role="dialog" aria-modal="true"`), which is the
//     signal the docked preview panel's two-stage ESC rule looks for: ESC
//     closes ONLY the lightbox and the dock stays open.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { SPRING_DRAWER, TWEEN } from '@/lib/motion';
import { usePortalHost } from '@/components/usePortalHost';

export interface LightboxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface BodyImage {
  src: string;
  alt: string;
  /** Viewport rect of the clicked <img> at click time (`getBoundingClientRect`). */
  rect: LightboxRect;
  /** false = 不做 FLIP（左右切换到的相邻图：没有被点击的缩略图可飞），直接淡入。 */
  flip?: boolean;
  /** 底部说明（报告：文件名 · 发送人 · 时间）。 */
  caption?: string;
}

/** 左右切换（报告里的图片按正文顺序成一个相册）。 */
export interface LightboxNav {
  index: number;
  count: number;
  onPrev: () => void;
  onNext: () => void;
}

/** A type alias, not an interface: Motion's `Target` carries an index signature that only type literals satisfy. */
export type FlipFrom = { x: number; y: number; scaleX: number; scaleY: number };

const IDENTITY: FlipFrom = { x: 0, y: 0, scaleX: 1, scaleY: 1 };

/**
 * The transform (origin centre) that maps the resting `box` back onto the
 * clicked `from` rect — the FLIP's `initial`. A box without size (image not
 * decoded yet) yields the identity so the caller can wait for `onLoad`.
 * Pure — pinned by tests/zones-toc-offset.test.ts.
 */
export function flipFrom(from: LightboxRect, box: LightboxRect): FlipFrom {
  if (!(box.width > 0) || !(box.height > 0) || !(from.width > 0) || !(from.height > 0)) return IDENTITY;
  return {
    x: from.left + from.width / 2 - (box.left + box.width / 2),
    y: from.top + from.height / 2 - (box.top + box.height / 2),
    scaleX: from.width / box.width,
    scaleY: from.height / box.height,
  };
}

function isIdentity(f: FlipFrom): boolean {
  return f.x === 0 && f.y === 0 && f.scaleX === 1 && f.scaleY === 1;
}

export function BodyImageLightbox({ image, onClose, nav }: { image: BodyImage | null; onClose: () => void; nav?: LightboxNav | null }) {
  const tc = useTranslations('common');
  const t = useTranslations('zones');
  const reduce = useReducedMotion();
  const host = usePortalHost();
  const imgRef = useRef<HTMLImageElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const navRef = useRef(nav);
  // FLIP delta keyed by src：换图（左右切换 / 快速再点另一张）自动回到「未测量」而不用先清状态；
  // 关闭时保留着（退场动画还要用），onExitComplete 再清。null = resting box not measured yet (img invisible meanwhile).
  const [flip, setFlip] = useState<{ src: string; from: FlipFrom } | null>(null);
  const from: FlipFrom | null = image && flip && flip.src === image.src ? flip.from : null;
  const setFrom = useCallback((f: FlipFrom | null) => setFlip(f && image ? { src: image.src, from: f } : null), [image]);

  useEffect(() => {
    onCloseRef.current = onClose;
    navRef.current = nav;
  });

  const measure = useCallback(() => {
    if (!image) return;
    if (reduce || image.flip === false) {
      setFrom(IDENTITY);
      return;
    }
    const el = imgRef.current;
    if (!el) return;
    const f = flipFrom(image.rect, el.getBoundingClientRect());
    // A 0×0 box means the browser has not laid the image out yet — onLoad re-measures.
    if (isIdentity(f) && el.naturalWidth === 0) return;
    setFrom(f);
  }, [image, reduce, setFrom]);

  // 关闭时**不要**在这里把 from 清掉：AnimatePresence 还在放退场动画，清掉 = 图片立刻 invisible、只剩黑底在淡——
  // 看起来就是「关闭时屏幕闪一下」（owner 2026-10-21）。改在 onExitComplete 里清。
  useLayoutEffect(() => {
    if (!image) return;
    measure();
  }, [image, measure]);

  // ESC / ← → + body scroll lock + focus, keyed on `image` only (an unstable
  // onClose must not re-run the lock).
  useEffect(() => {
    if (!image) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      const n = navRef.current;
      if (!n || n.count < 2) return;
      if (e.key === 'ArrowLeft') (e.preventDefault(), n.onPrev());
      else if (e.key === 'ArrowRight') (e.preventDefault(), n.onNext());
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const raf = requestAnimationFrame(() => dialogRef.current?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [image]);

  if (!host) return null;

  const fade = { duration: reduce ? 0 : 0.2 };
  const navBtn = 'absolute top-1/2 z-[1] flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/25 disabled:opacity-30 disabled:hover:bg-white/10';

  return createPortal(
    <AnimatePresence onExitComplete={() => setFrom(null)}>
      {image && (
        <motion.div
          key="lightbox"
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={image.alt || t('post_image_open')}
          tabIndex={-1}
          onClick={onClose}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4 outline-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={fade}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label={tc('dismiss')}
            className="absolute right-4 top-4 z-[1] flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
          {nav && nav.count > 1 && (
            <>
              <button
                type="button"
                aria-label={t('lightbox_prev')}
                disabled={nav.index <= 0}
                onClick={(e) => {
                  e.stopPropagation();
                  nav.onPrev();
                }}
                className={`${navBtn} left-3`}
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                type="button"
                aria-label={t('lightbox_next')}
                disabled={nav.index >= nav.count - 1}
                onClick={(e) => {
                  e.stopPropagation();
                  nav.onNext();
                }}
                className={`${navBtn} right-3`}
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}
          {/* The measuring instance is invisible; once the resting box is known
              the element REMOUNTS (key) so `initial` carries the FLIP delta.
              Closing flies the image back onto its thumbnail (exit = the same delta). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <motion.img
            key={`${image.src}|${from ? 'ready' : 'measure'}`}
            ref={imgRef}
            src={image.src}
            alt={image.alt}
            draggable={false}
            onClick={(e) => e.stopPropagation()}
            onLoad={() => {
              if (!from) measure();
            }}
            className={`max-h-[88vh] max-w-[94vw] select-none rounded-lg object-contain shadow-2xl ${from ? '' : 'invisible'}`}
            initial={from ? (image.flip === false ? { opacity: 0 } : from) : false}
            animate={from ? { ...IDENTITY, opacity: 1 } : undefined}
            exit={from && !reduce && image.flip !== false ? { ...from, opacity: 0.4, transition: TWEEN } : { opacity: 0, transition: fade }}
            transition={reduce ? { duration: 0 } : image.flip === false ? TWEEN : SPRING_DRAWER}
          />
          {(nav && nav.count > 1) || image.caption ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-4 flex flex-col items-center gap-1 px-16 text-center text-xs text-white/80">
              {image.caption && <span className="max-w-full truncate">{image.caption}</span>}
              {nav && nav.count > 1 && (
                <span className="font-mono tabular-nums">
                  {nav.index + 1} / {nav.count}
                </span>
              )}
            </div>
          ) : null}
        </motion.div>
      )}
    </AnimatePresence>,
    host,
  );
}
