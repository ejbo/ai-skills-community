// 封面渲染 — the ONE renderer for the shared cover contract (lib/media/cover-pos.ts).
// Fills its parent (`absolute inset-0`), so the CALLER owns the slot's size and
// shape; this component only decides how the image sits inside it.
//
//   slot="adaptive"   the caller already shaped the slot to the cover's aspect
//                     (a portrait row thumb, the billboard artwork). The image
//                     fills the slot per `pos`.
//   slot="landscape"  the slot is landscape whatever the cover is — a uniform
//   (default)         16:9 card grid, a 2:1 header. A landscape cover fills it; a
//                     PORTRAIT cover is shown as a centred portrait frame standing
//                     on a blurred copy of itself, so a tall poster is never
//                     reduced to the sliver a centre crop would leave of it.
//
// `pos` inside whichever frame applies: '' = centre crop, 'x% y%' = the author's
// crop, 'contain' = the whole image (blurred backdrop behind it).
//
// No hooks, no 'use client': it renders inside RSC pages and client cards alike.
// The backdrop copy reuses the SAME url (one request, one decode) and is
// `aria-hidden`; `scale-110` hides the transparent fringe a blur leaves at the
// edges. Stored urls are root-relative ⇒ withBasePath here, at render time.

import { withBasePath } from '@/lib/base-path';
import { coverAspectOf, coverObjectPosition, coverPosOf, isContainPos, type CoverAspect } from '@/lib/media/cover-pos';

export interface CoverImageProps {
  /** Stored root-relative url, or a blob:/http(s) url (withBasePath passes those through). */
  src: string;
  alt?: string;
  aspect?: CoverAspect | string | null;
  pos?: string | null;
  slot?: 'landscape' | 'adaptive';
  /** Width ÷ height of the inner portrait frame in a landscape slot. Default 3/4. */
  portraitRatio?: number;
  loading?: 'lazy' | 'eager';
  /** Extra classes for the foreground image (e.g. a hover zoom, an opacity transition). */
  imgClassName?: string;
  /** Extra classes for the wrapper. */
  className?: string;
  draggable?: boolean;
}

export function CoverImage({
  src,
  alt = '',
  aspect,
  pos,
  slot = 'landscape',
  portraitRatio = 3 / 4,
  loading = 'lazy',
  imgClassName = '',
  className = '',
  draggable,
}: CoverImageProps) {
  const url = withBasePath(src);
  const a = coverAspectOf(aspect);
  const p = coverPosOf(pos);
  const contain = isContainPos(p);
  const framed = slot === 'landscape' && a === 'portrait';

  const backdrop = (
    // eslint-disable-next-line @next/next/no-img-element -- stored root-relative media url
    <img
      src={url}
      alt=""
      aria-hidden
      loading={loading}
      draggable={false}
      className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-70 blur-xl saturate-150"
    />
  );

  if (framed) {
    return (
      <div className={`absolute inset-0 overflow-hidden [overflow:clip] bg-zinc-900 ${className}`}>
        {backdrop}
        <div className="absolute inset-0 bg-black/25" aria-hidden />
        <div
          className="absolute left-1/2 top-0 h-full -translate-x-1/2 overflow-hidden"
          style={{ aspectRatio: String(portraitRatio) }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- stored root-relative media url */}
          <img
            src={url}
            alt={alt}
            loading={loading}
            draggable={draggable}
            className={`h-full w-full ${contain ? 'object-contain' : 'object-cover'} ${imgClassName}`}
            style={contain ? undefined : { objectPosition: coverObjectPosition(p) }}
          />
        </div>
      </div>
    );
  }

  if (contain) {
    return (
      <div className={`absolute inset-0 overflow-hidden [overflow:clip] bg-zinc-900 ${className}`}>
        {backdrop}
        <div className="absolute inset-0 bg-black/25" aria-hidden />
        {/* eslint-disable-next-line @next/next/no-img-element -- stored root-relative media url */}
        <img
          src={url}
          alt={alt}
          loading={loading}
          draggable={draggable}
          className={`relative h-full w-full object-contain ${imgClassName}`}
        />
      </div>
    );
  }

  return (
    <div className={`absolute inset-0 overflow-hidden [overflow:clip] ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- stored root-relative media url */}
      <img
        src={url}
        alt={alt}
        loading={loading}
        draggable={draggable}
        className={`h-full w-full object-cover ${imgClassName}`}
        style={{ objectPosition: coverObjectPosition(p) }}
      />
    </div>
  );
}
