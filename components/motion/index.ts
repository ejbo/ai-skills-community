// 技术专区 motion kit — barrel.
//
// RULES EVERY PIECE FOLLOWS (and every caller must keep):
// 1. SSR-visible. Nothing server-rendered starts hidden: no `initial` prop on
//    content that comes from the server — the hidden start lives in
//    `whileInView` keyframe arrays (`opacity: [0, 1]`), so no-JS, slow
//    hydration and crawlers all see the finished page. `initial` is only used
//    on client-only mounts (DrawerShell, LiveList inserts, Stepper slides
//    behind `AnimatePresence initial={false}`).
// 2. Hydration-identical. `useReducedMotion()` is `null` on the server; both
//    branches render the SAME element with the same attributes
//    (`whileInView={reduce ? undefined : …}`), never an early-return <div> —
//    React 18 does not patch attribute mismatches, so a divergent SSR style
//    would stick.
// 3. No `window`/`document` at render. Pointer capability and matchMedia live
//    in effects (`useFinePointer`), geometry is read in event handlers, the
//    drawer portals only after mount.
// 4. Reduced motion + touch degrade to static. Framer pieces gate on
//    `useReducedMotion` (+ `useFinePointer` for pointer-following effects);
//    CSS pieces (GlareHover, HairlineGrid drift) are zeroed by the global
//    `prefers-reduced-motion` rule in globals.css and `motion-safe:`.
// 5. Monochrome. zinc + `rgb(var(--text) / α)` / `rgb(var(--border) / α)`,
//    light ≤ 8% alpha, hairline indicators — never a hue, glow or filled pill.
// 6. Budget: one entrance choreography per viewport (BlurText OR a grid
//    cascade, not both on one fold); hover ≤ 2px / scale ≤ 1.02; springs
//    stiffness 300–500, damping ≥ 22; tweens 0.2–0.6 s on EASE_OUT.
//
// 7. Two hosts for a side panel, deliberately distinct: DrawerShell is MODAL
//    (portal, scrim, body scroll lock, aria-modal, swipe-to-close — menus and the
//    phone preview); DockShell is NON-MODAL (an in-flow sticky aside with a
//    resize sash, no scrim, no scroll lock, no aria-modal — the 技术专区 reading
//    panel). Never give the dock a scrim "for consistency"; parallel reading is
//    the point.
//
// Server components: GlareHover, HairlineGrid. Everything else is 'use client'.

export { SpotlightCard } from './SpotlightCard';
export { BlurText } from './BlurText';
export { CountUp } from './CountUp';
export { Magnetic } from './Magnetic';
export { StaggerGrid, LiveList } from './StaggerList';
export { GlareHover } from './GlareHover';
export { TiltCard } from './TiltCard';
export { TabBar } from './TabBar';
export type { TabItem } from './TabBar';
export { Stepper } from './Stepper';
export type { Step } from './Stepper';
export { HairlineGrid } from './HairlineGrid';
export { DrawerShell } from './DrawerShell';
export { DockShell } from './DockShell';
export type { DockShellProps } from './DockShell';
export { StatefulButton } from './StatefulButton';
export { RollingNumber } from './RollingNumber';
