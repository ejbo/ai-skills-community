'use client';

// The navbar's hover mega-menu.
//
// Motion: ONE panel that MORPHS between nav items instead of a separate
// dropdown per item (the Aceternity <NavbarMenu /> idea), built the way Stripe
// and Radix build a navigation viewport — and deliberately NOT the way the first
// cut did it. That version used framer `layout` plus Aceternity's under-damped
// spring (`damping: 11.5`). `layout` animates a box with a SCALE transform, so
// sliding from 技术专区 (a 540px 研究所 grid) to 讨论区 (two links) painted the
// small menu blown up to the big box's scale and then shrinking — oversized
// text, spilling past the panel's own edge — and the spring overshot on top of
// it (owner, 2026-09-15: 「直接变为大字然后再缩小，已经超出了框的范围外」).
//
// Now three independent pieces, none of which ever scales text:
//   • the VIEWPORT animates real `width`/`height` (motion values) to the
//     measured natural size of the current pane, and clips (`overflow-hidden`);
//   • the SHELL slides horizontally (`x`, a translate) to stay centred under
//     the trigger;
//   • the PANES crossfade, the old one drifting out and the new one in along
//     the direction the pointer travelled. Both are absolutely placed at the
//     top-left, so neither affects the other's measurement.
// All three ride the house tweens (lib/motion.ts): no overshoot, ~0.28s.
// Per the 配色契约 the panel is ink and hairlines; colour is left to the
// material inside it (a 研究所's artwork, a taxonomy chip).
//
// Two structural constraints, both learned the hard way elsewhere in this app:
//
//  • PORTALED. `NavBarShell` animates `transition-transform`, which makes it a
//    containing block for `position: fixed` — a panel rendered inside the bar
//    is trapped in it. Same trap as the bubble menus and DeptTag's tooltip.
//  • THE ROW IS MEASURED. `nav-overflow.tsx` caches each link's natural
//    `offsetWidth` and packs the row from those numbers. So this panel adds NO
//    wrapper element and NO width-changing hover style to the links — it hangs
//    entirely off pointer events and `getBoundingClientRect()`. Wrapping the
//    anchors would silently over-pack the row and clip the last link.
//
// Hover-only by design (`useFinePointer`): a touch device has no hover, and the
// row shows zero inline links on a phone anyway — everything is in 收纳.

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { createPortal } from 'react-dom';
import { AnimatePresence, animate, motion, useIsPresent, useMotionValue, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { identityColor } from '@/components/Avatar';
import { withBasePath } from '@/lib/base-path';
import { TWEEN_FAST, TWEEN_PANE, useFinePointer } from '@/lib/motion';
import { INSTITUTE_TILE_MAX } from '@/lib/org';
import { NAV_MEGA, labHref, type MegaColumn, type MegaMenu } from '@/components/nav-mega-items';
import type { ZoneLabCard } from '@/lib/zones/labs';

/** How far a pane drifts while it crossfades (px) — a hint of direction, not a slide. */
const PANE_DRIFT = 20;
const OPEN_DELAY = 120;
const CLOSE_DELAY = 180;
const EDGE_PX = 12;
const GAP_PX = 10;
/**
 * Placeholder tiles shown while `/api/zones/labs` is in flight — one per
 * configured 研究所. The count comes from lib/org.ts, which is import-free (no
 * Prisma, no next-intl) exactly so the client may read the org tree.
 * lib/zones/labs.ts — which DRESSES that tree with live counts — may still not
 * be imported here: it reaches the database layer.
 */
const LAB_SKELETONS = INSTITUTE_TILE_MAX;

/** Shared across every mount — the lab grid is fetched once per page load. */
let labCache: ZoneLabCard[] | null = null;
let labInflight: Promise<ZoneLabCard[]> | null = null;

async function loadLabs(): Promise<ZoneLabCard[]> {
  if (labCache) return labCache;
  if (labInflight) return labInflight;
  labInflight = (async () => {
    try {
      const res = await fetch('/api/zones/labs');
      // A 401 (session expired) or 429 (the shared zones:hub bucket, spent by
      // the /zones feed) is transient — returning [] WITHOUT caching lets the
      // next hover try again instead of blanking the grid for the session.
      if (!res.ok) return [];
      const data = (await res.json()) as { labs?: ZoneLabCard[] };
      labCache = data.labs ?? [];
      return labCache;
    } catch {
      return [];
    } finally {
      labInflight = null;
    }
  })();
  return labInflight;
}

export interface MegaHoverApi {
  /** Called by a nav link's `onPointerEnter`; `el` is the anchor itself. */
  onEnter: (href: string, el: HTMLElement) => void;
  onLeave: () => void;
  /** The href whose panel is open, for the trigger's own styling. */
  activeHref: string | null;
}

/**
 * Owns the hover state and renders the panel. Returns handlers for the row to
 * put straight on its existing anchors — no wrapper elements.
 */
export function useNavMega(): MegaHoverApi & { panel: React.ReactNode } {
  const fine = useFinePointer();
  const pathname = usePathname();
  const [active, setActive] = useState<{ href: string; rect: DOMRect } | null>(null);
  const [host, setHost] = useState<Element | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  useEffect(() => setHost(document.body), []);
  useEffect(
    () => () => {
      if (openTimer.current) window.clearTimeout(openTimer.current);
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  const clearTimers = () => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  };

  const onEnter = useCallback(
    (href: string, el: HTMLElement) => {
      if (!fine || !NAV_MEGA[href]) return;
      clearTimers();
      // Already open on another item: morph immediately, no re-delay — that
      // sliding hand-off between items is the effect.
      const delay = active ? 0 : OPEN_DELAY;
      openTimer.current = window.setTimeout(() => {
        setActive({ href, rect: el.getBoundingClientRect() });
      }, delay);
    },
    [active, fine],
  );

  const onLeave = useCallback(() => {
    clearTimers();
    closeTimer.current = window.setTimeout(() => setActive(null), CLOSE_DELAY);
  }, []);

  // The panel is portaled, so pointer travel from the link to the panel leaves
  // the trigger. Cancelling the pending close on the panel's own enter is what
  // makes the gap crossable.
  const holdOpen = useCallback(() => clearTimers(), []);

  // Clicking a link inside the panel soft-navigates without moving the pointer,
  // so no leave event ever fires — and at scrollY 0 (the usual case, since the
  // bar auto-hides on scroll-down) no scroll event fires either. The panel
  // would sit over the page it just navigated to, eating clicks.
  useEffect(() => {
    setActive(null);
  }, [pathname]);

  // A scroll or resize invalidates the anchor rect; the bar may even slide
  // away. Close rather than leave a panel floating over unrelated content.
  useEffect(() => {
    if (!active) return;
    const close = () => setActive(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [active]);

  const panel =
    host &&
    createPortal(
      <AnimatePresence>
        {active && (
          <MegaPanel
            href={active.href}
            rect={active.rect}
            onPointerEnter={holdOpen}
            onPointerLeave={onLeave}
          />
        )}
      </AnimatePresence>,
      host,
    );

  return { onEnter, onLeave, activeHref: active?.href ?? null, panel };
}

function MegaPanel({
  href,
  rect,
  onPointerEnter,
  onPointerLeave,
}: {
  href: string;
  rect: DOMRect;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}) {
  const reduce = useReducedMotion();
  const menu = NAV_MEGA[href];

  // Real box size + horizontal offset, driven imperatively. The FIRST
  // measurement jumps (`set`) so the panel opens already in place — animating
  // it from a guess is exactly the sideways slide on open the old
  // measure-then-place pass had to hide. Every later one tweens.
  const width = useMotionValue(0);
  const height = useMotionValue(0);
  const x = useMotionValue(0);
  const [placed, setPlaced] = useState(false);
  const placedRef = useRef(false);

  // Which way the pointer travelled, so panes drift the same way (+1 = right).
  // Decided DURING render, not in an effect: the incoming pane reads its
  // `enter` variant on mount, and a direction set a commit later would make
  // every hand-off drift the way the previous one did. Idempotent under a
  // double render — the second pass sees the same href and keeps the value.
  const travel = useRef({ href, left: rect.left, dir: 0 });
  if (travel.current.href !== href) {
    travel.current = { href, left: rect.left, dir: rect.left >= travel.current.left ? 1 : -1 };
  }
  const dir = travel.current.dir;

  const rectRef = useRef(rect);
  rectRef.current = rect;
  const reduceRef = useRef(reduce);
  reduceRef.current = reduce;

  const onSize = useCallback(
    (w: number, h: number) => {
      const r = rectRef.current;
      // Centre under the trigger, then clamp into the viewport.
      const centred = r.left + r.width / 2 - w / 2;
      const max = Math.max(EDGE_PX, window.innerWidth - EDGE_PX - w);
      const left = Math.round(Math.min(Math.max(centred, EDGE_PX), max));
      if (!placedRef.current || reduceRef.current) {
        width.set(w);
        height.set(h);
        x.set(left);
        if (!placedRef.current) {
          placedRef.current = true;
          setPlaced(true);
        }
        return;
      }
      void animate(width, w, TWEEN_PANE);
      void animate(height, h, TWEEN_PANE);
      void animate(x, left, TWEEN_PANE);
    },
    [width, height, x],
  );

  if (!menu) return null;

  return (
    <motion.div
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
      // Short and eased-in on the way out: the panel must stop swallowing
      // clicks as soon as it has visually gone.
      exit={reduce ? { opacity: 0, transition: { duration: 0.1 } } : { opacity: 0, y: -4, transition: { duration: 0.14, ease: 'easeIn' } }}
      transition={reduce ? { duration: 0.12 } : TWEEN_FAST}
      style={{
        x,
        top: Math.round(rect.bottom + GAP_PX),
        left: 0,
        // Invisible until the first pane has measured itself (a layout effect,
        // so this flips before the first paint).
        visibility: placed ? 'visible' : 'hidden',
      }}
      className="fixed z-[65]"
    >
      {/* Bridges the gap between the bar and the panel so the pointer never
          crosses dead space and triggers the close timer. */}
      <span aria-hidden className="absolute inset-x-0 -top-3 h-3" />
      {/* A ring, not a border: box-shadow sits outside the animated box, so the
          measured content size IS the box size. */}
      <motion.div
        style={{ width, height }}
        className="relative overflow-hidden rounded-2xl bg-white/95 shadow-xl shadow-black/10 ring-1 ring-zinc-200/80 backdrop-blur-xl dark:bg-zinc-950/95 dark:shadow-black/50 dark:ring-zinc-800/80"
      >
        <AnimatePresence initial={false} custom={dir}>
          <Pane key={href} dir={dir} reduce={Boolean(reduce)} onSize={onSize}>
            <MenuContent menu={menu} />
          </Pane>
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

/**
 * One menu's content, absolutely placed at the viewport's top-left and sized to
 * its own content (`w-max`), so it can be measured while another pane is still
 * fading out on top of it. Only the PRESENT pane reports its size: an exiting
 * one whose grid finishes loading must not drag the box back to the old menu.
 */
function Pane({
  dir,
  reduce,
  onSize,
  children,
}: {
  dir: number;
  reduce: boolean;
  onSize: (w: number, h: number) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isPresent = useIsPresent();
  const presentRef = useRef(isPresent);
  presentRef.current = isPresent;
  const onSizeRef = useRef(onSize);
  onSizeRef.current = onSize;

  // Before paint: the first report is what places the panel.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => {
      if (presentRef.current) onSizeRef.current(el.offsetWidth, el.offsetHeight);
    };
    report();
    // The 研究所 grid swaps its skeletons for however many labs exist.
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <motion.div
      ref={ref}
      custom={dir}
      variants={{
        enter: (d: number) => ({ opacity: 0, x: reduce ? 0 : d * PANE_DRIFT }),
        center: { opacity: 1, x: 0 },
        exit: (d: number) => ({ opacity: 0, x: reduce ? 0 : d * -PANE_DRIFT }),
      }}
      initial="enter"
      animate="center"
      exit="exit"
      transition={reduce ? { duration: 0.1 } : TWEEN_PANE}
      // An exiting pane is still under the pointer for a few frames — it must
      // not take the click meant for the menu that replaced it.
      style={{ pointerEvents: isPresent ? undefined : 'none' }}
      className="absolute left-0 top-0 w-max p-4"
    >
      {children}
    </motion.div>
  );
}

function MenuContent({ menu }: { menu: MegaMenu }) {
  const label = useLabel();
  const hasHeading = menu.columns.some((c) => c.t);

  if (menu.kind === 'labs') {
    // The 研究所 grid is two rows of three, so a link COLUMN beside it would
    // leave a half-panel of dead space under three short links. They sit
    // under the grid instead, as a hairline-separated footer row.
    return (
      <div className="min-w-0">
        <LabGrid />
        <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-zinc-200/70 pt-2 dark:border-zinc-800/80">
          {menu.columns.flatMap((c) => c.links).map((l) => (
            <Link
              key={`${l.href}|${l.t}`}
              href={l.href}
              className="rounded-lg px-2.5 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-900 hover:text-white dark:text-zinc-300 dark:hover:bg-zinc-100 dark:hover:text-zinc-900"
            >
              {label(l.t)}
            </Link>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-7">
      {menu.columns.map((col, i) => (
        // A column with no heading still reserves the heading row, so its
        // first link lines up with its neighbours' first links instead of
        // riding up into their headings.
        <Column key={i} col={col} reserveHeading={hasHeading} />
      ))}
    </div>
  );
}

/**
 * Resolves a `<namespace>:<key>` label. Every namespace is client-allowlisted.
 *
 * Only the namespaces NAV_MEGA actually names are hooked: a `useTranslations`
 * for an unused one is a namespace this component would keep alive in
 * `CLIENT_MESSAGE_NAMESPACES` (tests/i18n-client-namespaces.test.ts reads the
 * client module graph) for nothing. Add the hook back beside the label.
 */
function useLabel() {
  const nav = useTranslations('nav');
  const shorts = useTranslations('shorts');
  const discussion = useTranslations('discussion');
  return (spec: string) => {
    const i = spec.indexOf(':');
    const ns = spec.slice(0, i);
    const key = spec.slice(i + 1);
    switch (ns) {
      case 'shorts':
        return shorts(key);
      case 'discussion':
        return discussion(key);
      default:
        return nav(key);
    }
  };
}

function Column({ col, reserveHeading }: { col: MegaColumn; reserveHeading: boolean }) {
  const label = useLabel();
  return (
    <div className="min-w-[9rem]">
      {(col.t || reserveHeading) && (
        <div
          aria-hidden={col.t ? undefined : true}
          className="mb-2 px-2 text-[11px] font-medium uppercase tracking-wide text-muted"
        >
          {col.t ? label(col.t) : '\u00A0'}
        </div>
      )}
      <ul className="flex flex-col gap-0.5">
        {col.links.map((l) => (
          <li key={`${l.href}|${l.t}`}>
            <Link
              href={l.href}
              className="block truncate rounded-lg px-2 py-1.5 text-sm text-zinc-700 transition-colors hover:bg-zinc-900 hover:text-white dark:text-zinc-300 dark:hover:bg-zinc-100 dark:hover:text-zinc-900"
            >
              {label(l.t)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 技术专区: the 研究所 grid. Loaded on first hover, then cached for the session. */
function LabGrid() {
  const t = useTranslations('nav');
  const [labs, setLabs] = useState<ZoneLabCard[] | null>(labCache);

  useEffect(() => {
    if (labs) return;
    let alive = true;
    void loadLabs().then((l) => {
      if (alive) setLabs(l);
    });
    return () => {
      alive = false;
    };
  }, [labs]);

  if (labs && labs.length === 0) return null;

  return (
    <div className="min-w-0">
      <div className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted">
        {t('mega_labs')}
      </div>
      {/* Wrap rather than a fixed column count: a 3-column grid reserves empty
          tracks when fewer 研究所 are configured than the cap, which stretched
          the panel around nothing. `max-w` caps it at three per row, so the six
          configured tiles land as two rows of three. */}
      <div className="flex max-w-[33rem] flex-wrap gap-2">
        {(labs ?? Array.from({ length: LAB_SKELETONS }, () => null)).map((lab, i) =>
          lab ? <LabTile key={lab.lab} lab={lab} /> : <LabSkeleton key={i} />,
        )}
      </div>
    </div>
  );
}

function LabTile({ lab }: { lab: ZoneLabCard }) {
  const t = useTranslations('nav');
  // No artwork anywhere ⇒ generate one, the way an avatar generates its
  // fallback: a name-hashed hue from the identity palette plus the first
  // character. Stable per 研究所, and colour on material is the contract.
  const hue = identityColor(lab.lab);
  // A configured `image` in lib/org.ts is a filename someone types by hand
  // (public/labs/README.md names them), so a typo — or a picture not dropped in
  // yet — is the expected state, not an accident. Falling back to the generated
  // cover keeps a half-filled six-tile grid looking finished instead of showing
  // six broken-image glyphs. Reset on `imageUrl` so a later fix repaints.
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [lab.imageUrl]);
  // Chinese org VALUES are never translated (the EVENT_CITIES precedent) — only
  // the label around them is.
  const labs = lab.labs.join(' · ');
  return (
    <Link
      href={labHref(lab.lab)}
      className="card-hover group block w-[10.5rem] overflow-hidden rounded-xl border border-zinc-200/80 bg-white dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="relative aspect-[16/9] overflow-hidden bg-zinc-100 dark:bg-zinc-800">
        {lab.imageUrl && !broken ? (
          <img
            // Root-relative storage URL: withBasePath is required here — the
            // fetch shim does not cover <img src> (CLAUDE.md pitfall #9).
            src={withBasePath(lab.imageUrl)}
            alt={lab.sampleZoneName ?? lab.lab}
            loading="lazy"
            onError={() => setBroken(true)}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <span
            aria-hidden
            style={{ backgroundColor: hue }}
            className="flex h-full w-full items-center justify-center text-2xl font-semibold text-white"
          >
            {[...lab.lab][0] ?? '?'}
          </span>
        )}
      </div>
      {/* A 研究所 is COMPOSED OF 实验室, so the tile says which ones — that
          second line is what makes the grid read as a hierarchy instead of six
          unrelated names. It is rendered even when empty (「实验室待补充」) so a
          placeholder tile keeps the same height as a filled one; the full list
          is in the `title` because it truncates at 168px. */}
      <div className="px-2.5 py-2">
        <div className="truncate text-[13px] font-medium">{lab.lab}</div>
        <div
          className="mt-0.5 truncate text-[11px] text-muted"
          title={labs || undefined}
        >
          <span className="sr-only">{t('mega_lab_labs')}: </span>
          {labs || t('mega_lab_labs_empty')}
        </div>
        <div className="mt-0.5 text-[11px] tabular-nums text-muted">
          {t('mega_lab_zones', { count: lab.zoneCount })}
        </div>
      </div>
    </Link>
  );
}

function LabSkeleton() {
  return (
    <div className="w-[10.5rem] overflow-hidden rounded-xl border border-zinc-200/80 dark:border-zinc-800">
      <div className="shimmer aspect-[16/9]" />
      <div className="space-y-1.5 px-2.5 py-2">
        <div className="shimmer h-3 w-2/3 rounded" />
        <div className="shimmer h-2.5 w-4/5 rounded" />
        <div className="shimmer h-2.5 w-1/3 rounded" />
      </div>
    </div>
  );
}

export type { MegaMenu };
