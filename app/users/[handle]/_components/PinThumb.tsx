'use client';

// The 精选 card thumbnail — the one client leaf of PinCard. Its only job is the
// failure path: a pinned item's cover can 404 (a vote winner whose file was
// cleaned up, a poster that never got generated) and a bare <img> then paints
// the browser's broken-image glyph inside an otherwise finished card. On error
// the <img> is dropped and the tile shows the kind's placeholder icon instead,
// which is how the same item degrades on its board's own card.
//
// The server-rendered <img> can fail BEFORE hydration attaches `onError`, so the
// mount effect also reads the element's settled state (`complete` with no
// intrinsic width = broken). A lazy image that has not started loading is not
// `complete`, so it is left to the handler.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Play } from 'lucide-react';
import { withBasePath } from '@/lib/base-path';

export function PinThumb({
  url,
  shape,
  playOverlay,
  placeholder,
}: {
  url: string;
  shape: 'tall' | 'wide';
  /** Draw the ▶ scrim (short / video posters). */
  playOverlay: boolean;
  /** The kind's icon, rendered by the server card. */
  placeholder: ReactNode;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, [url]);

  return (
    <span
      className={`relative shrink-0 overflow-hidden rounded-lg bg-zinc-100 ring-1 ring-black/5 dark:bg-zinc-900 dark:ring-white/10 ${
        shape === 'tall' ? 'h-[88px] w-[50px]' : 'h-[64px] w-[96px]'
      }`}
    >
      {failed ? (
        <span className="absolute inset-0 flex items-center justify-center text-zinc-400 dark:text-zinc-600" aria-hidden>
          {placeholder}
        </span>
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- stored root-relative media */}
          <img
            ref={ref}
            src={withBasePath(url)}
            alt=""
            loading="lazy"
            onError={() => setFailed(true)}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
          />
          {playOverlay && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/15">
              <Play className="h-4 w-4 text-white drop-shadow" fill="currentColor" aria-hidden />
            </span>
          )}
        </>
      )}
    </span>
  );
}
