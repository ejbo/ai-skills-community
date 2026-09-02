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
import { X } from 'lucide-react';
import { SPRING_DRAWER } from '@/lib/motion';
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

export function BodyImageLightbox({ image, onClose }: { image: BodyImage | null; onClose: () => void }) {
  const tc = useTranslations('common');
  const t = useTranslations('zones');
  const reduce = useReducedMotion();
  const host = usePortalHost();
  const imgRef = useRef<HTMLImageElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  // null = resting box not measured yet (the img is kept invisible meanwhile).
  const [from, setFrom] = useState<FlipFrom | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const measure = useCallback(() => {
    if (!image) return;
    if (reduce) {
      setFrom(IDENTITY);
      return;
    }
    const el = imgRef.current;
    if (!el) return;
    const f = flipFrom(image.rect, el.getBoundingClientRect());
    // A 0×0 box means the browser has not laid the image out yet — onLoad re-measures.
    if (isIdentity(f) && el.naturalWidth === 0) return;
    setFrom(f);
  }, [image, reduce]);

  useLayoutEffect(() => {
    if (!image) {
      setFrom(null);
      return;
    }
    measure();
  }, [image, measure]);

  // ESC + body scroll lock + focus, keyed on `image` only (an unstable
  // onClose must not re-run the lock).
  useEffect(() => {
    if (!image) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onCloseRef.current();
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

  return createPortal(
    <AnimatePresence>
      {image && (
        <motion.div
          key={image.src}
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
          {/* The measuring instance is invisible; once the resting box is known
              the element REMOUNTS (key) so `initial` carries the FLIP delta. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <motion.img
            key={from ? 'ready' : 'measure'}
            ref={imgRef}
            src={image.src}
            alt={image.alt}
            draggable={false}
            onClick={(e) => e.stopPropagation()}
            onLoad={() => {
              if (!from) measure();
            }}
            className={`max-h-[92vh] max-w-[94vw] select-none rounded-lg object-contain shadow-2xl ${from ? '' : 'invisible'}`}
            initial={from ?? false}
            animate={from ? IDENTITY : undefined}
            transition={reduce ? { duration: 0 } : SPRING_DRAWER}
          />
        </motion.div>
      )}
    </AnimatePresence>,
    host,
  );
}
