'use client';

// 技术专区 hub — the 版块墙: the hero's right half is a perspective-tilted plane
// of zone tiles, one per 版块 (busiest first), each a real link. It is the one
// deliberately three-dimensional thing under /zones and it earns it by being
// NAVIGATION, not decoration: a visitor sees every board as a place on a wall
// and clicks one.
//
// Mechanics, all CSS/transform (no WebGL, no new dependency):
//  • The plane is `preserve-3d` under a 1400px perspective, resting at a
//    gentle isometric pose (rotateX 22° · rotateY −16° · rotateZ 3°). Pointer
//    movement over the hero nudges rotateX/rotateY by ±5° through springs
//    (fine pointer + motion-safe only; touch and reduced-motion keep the pose).
//  • Every tile sits at its own `translateZ` (three depths) and drifts on the
//    `zone-float` keyframes in globals.css with a staggered delay — a slow
//    breathing, never a bounce. The float is on an INNER element so it never
//    fights the plane's own transform.
//  • The whole plane is a normal DOM grid, so it lays out, wraps and links like
//    any list. SSR renders the resting pose (a static transform is fine for a
//    no-JS reader); nothing starts at opacity 0.
//
// Colour is the zone's own (theme colour or name hash — zone-color.ts): the
// wall is material, and a wall of ink squares was exactly the problem.

import Link from 'next/link';
import { useCallback, type PointerEvent } from 'react';
import { motion, useMotionValue, useReducedMotion, useSpring } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { withBasePath } from '@/lib/base-path';
import { SPRING_SOFT, useFinePointer } from '@/lib/motion';
import { zoneHref } from '@/lib/zones/shared';
import type { ZoneCardView } from '@/lib/zones/types';
import { zoneHue } from './zone-color';

const REST_X = 22;
const REST_Y = -16;
const REST_Z = 3;
const NUDGE = 5;
const DEPTHS = [0, 14, 28];
export const WALL_MAX = 12;

export function ZoneWall3D({ zones, className = '' }: { zones: ZoneCardView[]; className?: string }) {
  const t = useTranslations('zones');
  const fine = useFinePointer();
  const reduce = useReducedMotion();
  const live = fine && !reduce;
  const rx = useMotionValue(REST_X);
  const ry = useMotionValue(REST_Y);
  const sx = useSpring(rx, SPRING_SOFT);
  const sy = useSpring(ry, SPRING_SOFT);

  const onMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!live) return;
      const r = e.currentTarget.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      rx.set(REST_X - py * NUDGE * 2);
      ry.set(REST_Y + px * NUDGE * 2);
    },
    [live, rx, ry],
  );
  const reset = useCallback(() => {
    rx.set(REST_X);
    ry.set(REST_Y);
  }, [rx, ry]);

  const items = zones.slice(0, WALL_MAX);
  if (items.length === 0) return null;
  // 2 columns up to four boards, 3 up to nine, then 4 — and bigger tiles when
  // there are few, so a young deployment's wall is not five small squares.
  const cols = items.length <= 4 ? 2 : items.length <= 9 ? 3 : 4;
  const tile = items.length <= 6 ? 'w-[6rem]' : 'w-[5.25rem]';

  return (
    <div
      onPointerMove={onMove}
      onPointerLeave={reset}
      onPointerCancel={reset}
      className={`relative flex items-center justify-center [perspective:1400px] ${className}`}
      aria-label={t('hub_wall_aria')}
    >
      <motion.ul
        // The column count follows how many boards exist — a wall with three
        // tiles is not a 4×3 grid with nine holes in it.
        style={{
          rotateX: sx,
          rotateY: sy,
          rotateZ: REST_Z,
          transformStyle: 'preserve-3d',
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        }}
        className="grid gap-x-6 gap-y-5 will-change-transform"
      >
        {items.map((zone, i) => {
          const hue = zoneHue(zone.name, zone.themeColor);
          const depth = DEPTHS[(i * 7) % DEPTHS.length];
          const delay = -((i * 1.3) % 6);
          return (
            <li key={zone.id} style={{ transform: `translateZ(${depth}px)`, transformStyle: 'preserve-3d' }} className={tile}>
              {/* `motion-safe:` (CSS) gates the float, not `reduce` — useReducedMotion is
                  null on the server, and a branching className would not hydrate. */}
              <div className="motion-safe:animate-zone-float" style={{ animationDelay: `${delay}s` }}>
                <Link
                  href={zoneHref(zone.slug)}
                  title={zone.name}
                  className="group block outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100"
                >
                  <span
                    className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl text-white transition-transform duration-300 ease-out group-hover:-translate-y-1"
                    style={{
                      backgroundColor: hue,
                      boxShadow: `0 18px 30px -14px ${hue}99, inset 0 1px 0 rgb(255 255 255 / 0.35)`,
                    }}
                  >
                    {zone.iconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- stored root-relative media URL
                      <img src={withBasePath(zone.iconUrl)} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <span className="font-mono text-2xl font-semibold uppercase">{zone.name.trim().charAt(0) || 'Z'}</span>
                    )}
                    {/* The lit face: a diagonal sheen that reads as a bevelled tile, not a flat chip. */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0"
                      style={{ background: 'linear-gradient(135deg, rgb(255 255 255 / 0.22) 0%, transparent 45%, rgb(0 0 0 / 0.12) 100%)' }}
                    />
                  </span>
                  <span className="mt-1.5 block truncate text-center text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                    {zone.name}
                  </span>
                </Link>
              </div>
            </li>
          );
        })}
      </motion.ul>
    </div>
  );
}
