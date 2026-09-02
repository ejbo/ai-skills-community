'use client';

// The navbar's hover mega-menu.
//
// Motion is the Aceternity <NavbarMenu /> idea: one panel that MORPHS between
// nav items instead of a separate dropdown per item — spring-scaled in, and
// `layout` animating its box as the content behind it changes size. Their
// spring is kept verbatim (`mass: 0.5, damping: 11.5, stiffness: 100`); their
// chrome is not. The original is a light rounded pill with coloured product
// cards, which is the wrong vocabulary here: per the 配色契约 the panel is ink
// and hairlines, and colour is left to the material inside it (a 研究所's
// artwork, a taxonomy chip).
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
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { identityColor } from '@/components/Avatar';
import { withBasePath } from '@/lib/base-path';
import { useFinePointer } from '@/lib/motion';
import { NAV_MEGA, labHref, type MegaColumn, type MegaMenu } from '@/components/nav-mega-items';
import type { ZoneLabCard } from '@/lib/zones/labs';

/** Aceternity's spring, unchanged. */
const SPRING = { type: 'spring', mass: 0.5, damping: 11.5, stiffness: 100 } as const;
const OPEN_DELAY = 120;
const CLOSE_DELAY = 180;
const EDGE_PX = 12;
const GAP_PX = 10;
/**
 * Placeholder tiles shown while `/api/zones/labs` is in flight. Matches
 * `LAB_TILE_MAX` / the curated list in lib/zones/labs.ts by hand — that module
 * imports Prisma, so importing the constant from it would drag the whole client
 * bundle into the database layer. Wrong by one is cosmetic (the panel resizes,
 * and the ResizeObserver below re-centres it); an import would not be.
 */
const LAB_SKELETONS = 6;

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
  const label = useLabel();
  const menu = NAV_MEGA[href];
  const ref = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState<number | null>(null);

  // Centre under the trigger, then clamp into the viewport. The width is only
  // knowable after the content renders, so this is a measure-then-place pass.
  const place = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const centred = rect.left + rect.width / 2 - w / 2;
    const max = Math.max(EDGE_PX, window.innerWidth - EDGE_PX - w);
    setLeft(Math.round(Math.min(Math.max(centred, EDGE_PX), max)));
  }, [rect]);

  // BEFORE paint, not after: with a plain effect the panel painted one frame at
  // the trigger's left edge and `layout` then animated the ~140px correction —
  // every open slid sideways.
  useLayoutEffect(() => {
    place();
  }, [place, href]);

  // The panel changes size after mount whenever its own content does — the 研究所
  // grid replaces three skeletons with however many labs exist. Without this the
  // panel keeps the `left` computed for the placeholder and hangs off-centre.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => place());
    ro.observe(el);
    return () => ro.disconnect();
  }, [place]);

  if (!menu) return null;

  const hasHeading = menu.columns.some((c) => c.t);

  return (
    <motion.div
      ref={ref}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      // `layout` morphs the box when you slide from one nav item to the next —
      // the panel resizes and travels instead of closing and reopening. It stays
      // OFF until the first placement lands, so the initial measure-then-place
      // correction is not animated as a slide-in.
      layout={!reduce && left !== null}
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: -6 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
      // Exit is a short TWEEN, not the spring: a spring with no duration keeps
      // settling for ~1.2s, and the panel goes on swallowing clicks under it
      // long after it has visually faded. The spring is the entrance.
      exit={
        reduce
          ? { opacity: 0, transition: { duration: 0.1 } }
          : { opacity: 0, scale: 0.97, y: -4, transition: { duration: 0.14, ease: 'easeIn' } }
      }
      transition={reduce ? { duration: 0.12 } : SPRING}
      style={{
        top: Math.round(rect.bottom + GAP_PX),
        left: left ?? Math.round(rect.left),
        // Invisible until measured, so it never paints once off-centre.
        visibility: left === null ? 'hidden' : 'visible',
      }}
      className="fixed z-[65] rounded-2xl border border-zinc-200/80 bg-white/95 p-4 shadow-xl shadow-black/10 backdrop-blur-xl dark:border-zinc-800/80 dark:bg-zinc-950/95 dark:shadow-black/50"
    >
      {/* Bridges the gap between the bar and the panel so the pointer never
          crosses dead space and triggers the close timer. */}
      <span aria-hidden className="absolute inset-x-0 -top-3 h-3" />
      {menu.kind === 'labs' ? (
        // The 研究所 grid is two rows of three, so a link COLUMN beside it would
        // leave a half-panel of dead space under three short links. They sit
        // under the grid instead, as a hairline-separated footer row.
        <motion.div layout={!reduce} className="min-w-0">
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
        </motion.div>
      ) : (
        <motion.div layout={!reduce} className="flex items-start gap-7">
          {menu.columns.map((col, i) => (
            // A column with no heading still reserves the heading row, so its
            // first link lines up with its neighbours' first links instead of
            // riding up into their headings.
            <Column key={i} col={col} reserveHeading={hasHeading} />
          ))}
        </motion.div>
      )}
    </motion.div>
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
          tracks when fewer 研究所 are curated than the cap, which stretched the
          panel around nothing. `max-w` caps it at three per row, so the six
          curated tiles land as two rows of three. */}
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
  // A curated `image` in lib/zones/labs.ts is a filename someone types by hand
  // (public/labs/README.md names them), so a typo — or a picture not dropped in
  // yet — is the expected state, not an accident. Falling back to the generated
  // cover keeps a half-filled six-tile grid looking finished instead of showing
  // six broken-image glyphs. Reset on `imageUrl` so a later fix repaints.
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [lab.imageUrl]);
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
      <div className="px-2.5 py-2">
        <div className="truncate text-[13px] font-medium">{lab.lab}</div>
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
        <div className="shimmer h-2.5 w-1/3 rounded" />
      </div>
    </div>
  );
}

export type { MegaMenu };
