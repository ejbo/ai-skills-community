'use client';

// Click-to-enlarge for event covers. The trigger is whatever children you pass
// (a thumbnail <img>); the enlarged view is portaled to <body> — the card's
// hover transform creates a containing block, so a plain `fixed` overlay would
// be trapped inside it. Esc / click / ✕ all close; body scroll locks while open.

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { withBasePath } from '@/lib/base-path';

export function ImageLightbox({
  src,
  alt = '',
  className,
  actions,
  children,
}: {
  src: string;
  alt?: string;
  className?: string;
  /** Optional action row rendered under the enlarged image (e.g. 添加到表情包). */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const tc = useTranslations('common');
  const te = useTranslations('events');
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, close]);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          // Cards are stretched links — the thumb must win the click.
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className={`relative z-10 block cursor-zoom-in ${className ?? ''}`}
        aria-label={alt || te('view_image')}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
            onClick={close}
            role="dialog"
            aria-modal="true"
          >
            <button
              type="button"
              onClick={close}
              aria-label={tc('dismiss')}
              className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
            >
              <X className="h-5 w-5" />
            </button>
            {actions ? (
              <div
                className="flex max-h-[92vh] max-w-[94vw] flex-col items-center gap-3"
                onClick={(e) => e.stopPropagation()}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={withBasePath(src)}
                  alt={alt}
                  className="min-h-0 max-h-[85vh] max-w-full rounded-lg object-contain shadow-2xl"
                />
                <div className="flex items-center gap-2">{actions}</div>
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={withBasePath(src)}
                alt={alt}
                className="max-h-[92vh] max-w-[94vw] rounded-lg object-contain shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              />
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
