'use client';

// Priority+ navigation for the navbar row.
//
// The row used to be a fixed list of `whitespace-nowrap` links with `min-w-0`,
// which meant it did not wrap, did not scroll and did not shrink — it simply
// ran under the search box. That was invisible in 中文 (2-character labels) and
// broke immediately in English ("Discussion", "Tech Zones") and French
// ("Bibliothèque", "Espaces techniques"). Rather than guess a breakpoint per
// language, the row MEASURES: it caches each link's natural width once the
// webfont has settled, then keeps only as many as fit the space the flex layout
// actually gave it. Everything that does not fit is handed to the overflow menu
// through this context, so no destination is ever merely clipped.
//
// The provider wraps the whole header, so the row (left) and the menu button
// (right action cluster) can be siblings in the DOM and still share one state.
// Server-rendered children passed through it keep working — context flows by
// tree position, not by who rendered the element.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { PRIMARY_NAV, STASHED_NAV, type NavItem } from '@/components/nav-items';
import { NavMoreMenu } from '@/components/NavMoreMenu';
import { useNavMega } from '@/components/NavMegaPanel';

/** Tailwind `gap-1` on the row. Kept in sync by hand — it is one number. */
const GAP_PX = 4;

interface OverflowCtx {
  /** Primary items that did not fit, in nav order. */
  overflow: NavItem[];
  setOverflowCount: (n: number) => void;
}

const Ctx = createContext<OverflowCtx | null>(null);

export function NavOverflowProvider({ children }: { children: ReactNode }) {
  // Server render shows every link; the first measurement pass corrects it.
  // Starting from 0 instead would flash a nav that fills in, which is worse.
  const [overflowCount, setOverflowCount] = useState(0);
  const value = useMemo<OverflowCtx>(
    () => ({
      overflow: overflowCount > 0 ? PRIMARY_NAV.slice(PRIMARY_NAV.length - overflowCount) : [],
      setOverflowCount,
    }),
    [overflowCount],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function useOverflow(): OverflowCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('nav overflow context missing');
  return ctx;
}

export function NavPrimaryRow() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const locale = useLocale();
  const { setOverflowCount } = useOverflow();

  const rowRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  /** Natural widths, cached while every link is still rendered at full size. */
  const widths = useRef<number[] | null>(null);
  const [visible, setVisible] = useState(PRIMARY_NAV.length);

  const fit = useCallback(() => {
    const row = rowRef.current;
    const w = widths.current;
    if (!row || !w) return;
    const avail = row.clientWidth;
    let used = 0;
    let n = 0;
    for (const width of w) {
      const next = used + (n === 0 ? 0 : GAP_PX) + width;
      if (next > avail) break;
      used = next;
      n++;
    }
    setVisible(n);
    setOverflowCount(PRIMARY_NAV.length - n);
  }, [setOverflowCount]);

  // Measure once the webfont has settled — a fallback-font pass would cache
  // widths that are wrong by enough to drop a link that actually fits. Until
  // then the row renders every link and `overflow-hidden` clips the spill.
  useEffect(() => {
    widths.current = null;
    let cancelled = false;
    const capture = () => {
      if (cancelled) return;
      const measured = itemRefs.current.slice(0, PRIMARY_NAV.length).map((el) => el?.offsetWidth ?? 0);
      if (measured.some((m) => m === 0)) return; // not laid out yet
      widths.current = measured;
      fit();
    };
    void document.fonts?.ready.then(capture);
    // Belt and braces: fonts.ready can resolve before layout on a warm cache.
    const raf = requestAnimationFrame(capture);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
    // Re-measure when the labels themselves change language.
  }, [locale, fit]);

  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(row);
    return () => ro.disconnect();
  }, [fit]);

  // Hover mega-menu. It hangs entirely off pointer events on the anchors below
  // and a portaled panel — deliberately NO wrapper element and no hover style
  // that changes a link's width, because `widths.current` is cached once per
  // locale and the ResizeObserver above watches only the row (whose width never
  // changes). A wrapper would also break the `absolute w-max` hide trick: the
  // wrapper would stay an in-flow flex item and `gap-1` would keep allocating
  // 4px beside every overflowed link, so `fit()` would over-pack the row.
  const mega = useNavMega();

  return (
    <>
    <div
      ref={rowRef}
      // flex-1 + min-w-0: the row takes exactly the space the logo and the
      // action cluster leave it, and `clientWidth` is therefore the budget the
      // measurement above spends. overflow-hidden makes the pre-measurement
      // frame clip instead of overlap the search box.
      className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
    >
      {PRIMARY_NAV.map((item, i) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        // Hidden links leave the tab order and the a11y tree; they are reachable
        // in the overflow menu, which renders the same destination.
        const hidden = i >= visible;
        return (
          <Link
            key={item.href}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            href={item.href}
            // Hidden links are `pointer-events-none`, so they can never open a
            // panel for a destination the row is not showing.
            onPointerEnter={(e) => mega.onEnter(item.href, e.currentTarget)}
            onPointerLeave={mega.onLeave}
            aria-current={active ? 'page' : undefined}
            aria-hidden={hidden || undefined}
            tabIndex={hidden ? -1 : undefined}
            // `absolute w-max` for the hidden ones, never `hidden`: they stay
            // measurable at their NATURAL width (max-content is immune to the
            // containing block), so a later re-measure — a font swap, a locale
            // change — reads the same numbers it would have read in flow.
            className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium transition lg:px-3 ${
              hidden ? 'pointer-events-none invisible absolute -z-10 w-max' : ''
            } ${
              active || mega.activeHref === item.href
                ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white'
                : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white'
            }`}
          >
            {t(item.key)}
          </Link>
        );
      })}
    </div>
    {mega.panel}
    </>
  );
}

/** The "收纳" button: overflowed primary links first, then the always-stashed ones. */
export function NavMoreButton() {
  const { overflow } = useOverflow();
  return <NavMoreMenu items={[...overflow, ...STASHED_NAV]} />;
}
