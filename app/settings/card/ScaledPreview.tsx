'use client';

// Renders a fixed-size child (a ProfileCard has intrinsic pixel sizes) scaled to
// the space it is given, WITHOUT guessing the child's height: the inner box is
// measured untransformed (offsetWidth/offsetHeight ignore transforms) and the
// outer box takes the SCALED height, so the page flows around the visible size.
// A ResizeObserver re-measures when either side changes (container resize, a
// style switch that changes the card's aspect).
//
//   fit="width" — always fill the width (style tiles: a 288 px card in a 100 px tile)
//   fit="down"  — never upscale (the live stage: 1× unless the phone is narrower than the card)
//
// The inner box is centred by flex (an overflowing flex item centres on both
// sides), so no translate is stacked on the scale; `items-start` stops flex from
// stretching it to the outer height, which would feed back into the measurement.
// The transform makes this a containing block for `position: fixed` — every
// popover inside a card is portaled to <body>, which is why that is safe here.

import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Box {
  scale: number;
  height: number;
}

export function ScaledPreview({
  children,
  fit,
  estimate,
  clip = false,
  className = '',
}: {
  children: ReactNode;
  fit: 'width' | 'down';
  /** Pre-measure guess `{ width, height }` of the child (avoids a first-paint jump). */
  estimate: { width: number; height: number };
  /** Clip overflow (tiles). The stage leaves it off so a card's glow can breathe. */
  clip?: boolean;
  className?: string;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const iw = inner.offsetWidth;
        const ih = inner.offsetHeight;
        const ow = outer.clientWidth;
        if (!iw || !ih || !ow) return;
        const raw = ow / iw;
        const scale = Math.round((fit === 'down' ? Math.min(1, raw) : raw) * 1000) / 1000;
        const height = Math.round(ih * scale);
        setBox((prev) => (prev && prev.scale === scale && prev.height === height ? prev : { scale, height }));
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    ro.observe(inner);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [fit]);

  // Before the first measurement: `fit="down"` renders 1× (correct for every
  // viewport wider than the card); `fit="width"` reserves the estimated aspect.
  const scale = box?.scale ?? (fit === 'down' ? 1 : null);

  return (
    <div
      ref={outerRef}
      className={`flex w-full items-start justify-center ${clip ? 'overflow-hidden' : ''} ${className}`}
      style={
        scale === null
          ? { aspectRatio: `${estimate.width} / ${estimate.height}` }
          : box
            ? { height: box.height }
            : undefined
      }
    >
      <div
        ref={innerRef}
        className="w-max shrink-0"
        style={
          scale === null
            ? { visibility: 'hidden' }
            : scale === 1
              ? undefined
              : { transform: `scale(${scale})`, transformOrigin: 'top center' }
        }
      >
        {children}
      </div>
    </div>
  );
}
