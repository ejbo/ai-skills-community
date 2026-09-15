'use client';

// 用户卡片 — wrap any name/avatar and it gains a hover card: the member's own
// 名片 (components/profile-card), exactly as they designed it.
//
// Fetching: one request per user (./card-cache — module-level cache + in-flight
// dedupe), fired on hover INTENT (150 ms) rather than on every pass of the
// pointer, so a list of forty annotators does not become forty requests when you
// sweep across it. Only a card (200) or a 404 is remembered, for 60 s and per
// signed-in viewer — never a 401 or a 5xx, so signing in with the credentials
// form (a soft navigation) shows cards on the next hover. Settings editors call
// `invalidateUserCard()` after a save, so a member's own card is never stale.
//
// Signed-out viewers get no card at all (the endpoint needs a session): no
// fetch, no skeleton blinking beside every byline of the public 讨论区. The
// wrapper span is rendered in every state so a sign-in never remounts children.
//
// The card component is imported LAZILY, on the first hover/focus intent: it
// carries ~33 KB of CSS and three card styles, and Avatar puts this module in
// the root layout through the navbar — a static import shipped all of it on
// every route, /auth/login included. The skeleton (./CardSkeleton) is CSS-free.
//
// Keyboard: when the nearest focusable host receives :focus-visible focus, the
// card opens. The host is a focusable element INSIDE the wrapper, or the nearest
// focusable ancestor when it links to this person's profile (`/users/<handle>`,
// the byline shape). A whole-card link around a skill or a vote is about the
// content, not the person — tabbing through a grid must not pop an author card on
// every stop. Tab from the host moves into the card, Tab past its last link
// continues after the host, Shift+Tab from its first returns to the host, Esc
// closes it (returning focus to the host when focus was inside), and it closes
// once focus has left both. The panel is a non-modal dialog (it holds links),
// never role=tooltip. Touch still opens it through the compat mouseenter a tap
// fires on a non-link avatar.
//
// What the card shows is decided server-side (GET /api/users/[handle]/card →
// ProfileCardView): 隐私账号 trimming, hidden badges, stats limited to the
// sections this viewer may see. Nothing is fetched-then-hidden here.

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { SessionContext } from 'next-auth/react';
import { ProfileCardSkeleton } from '@/components/profile-card/CardSkeleton';
import { CARD_WIDTH } from '@/components/profile-card/card-shared';
import { freshCardEntry, loadCardView } from '@/components/user/card-cache';
import { EASE_OUT } from '@/lib/motion';
import type { ProfileCardView } from '@/lib/profile/types';

// The fetch + cache rules live in ./card-cache (unit-tested); re-exported so the
// settings editors keep importing the invalidator from here.
export { invalidateUserCard } from '@/components/user/card-cache';

// ─── lazy card module ────────────────────────────────────────────────────

type CardComponent = (typeof import('@/components/profile-card/ProfileCard'))['ProfileCard'];

let cardModule: CardComponent | null = null;
let cardModulePromise: Promise<CardComponent | null> | null = null;

/** Starts (once) and awaits the card chunk + its stylesheet; null when the chunk failed to load. */
function loadCardModule(): Promise<CardComponent | null> {
  if (cardModule) return Promise.resolve(cardModule);
  cardModulePromise ??= import('@/components/profile-card/ProfileCard').then(
    (m) => (cardModule = m.ProfileCard),
    () => {
      cardModulePromise = null; // a later hover may retry (deploy swapped chunks, flaky network)
      return null;
    },
  );
  return cardModulePromise;
}

// ─── keyboard host ───────────────────────────────────────────────────────

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

function tabbables(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.tabIndex >= 0 && !el.closest('[inert]') && el.getClientRects().length > 0,
  );
}

function linksToProfile(el: HTMLElement, handle: string): boolean {
  if (!(el instanceof HTMLAnchorElement)) return false;
  try {
    const path = decodeURIComponent(new URL(el.href, window.location.href).pathname).replace(/\/+$/, '');
    return path.endsWith(`/users/${handle}`);
  } catch {
    return false;
  }
}

interface FocusHost {
  /** Where focusin/focusout/keydown are listened to. */
  listen: HTMLElement;
  /** The element that holds focus for this card (gets aria-controls/-expanded). */
  target: HTMLElement;
}

function resolveFocusHost(anchor: HTMLElement, handle: string): FocusHost | null {
  const inner = anchor.querySelector<HTMLElement>(FOCUSABLE);
  if (inner) return { listen: anchor, target: inner };
  const outer = anchor.parentElement?.closest<HTMLElement>(FOCUSABLE);
  if (outer && linksToProfile(outer, handle)) return { listen: outer, target: outer };
  return null;
}

// ─── placement ───────────────────────────────────────────────────────────

const OPEN_DELAY = 150;
const CLOSE_DELAY = 200;
const EDGE = 12;
const GAP = 10;
const SIZE = 'sm' as const;

/**
 * Nesting guard. `Avatar` carries a hover card whenever it is given a handle,
 * so an identity cluster that ALSO wraps its avatar+name in a card (to make the
 * name hoverable too) would otherwise stack two popovers on the same person.
 * The inner one steps aside instead — which also means a future call site can
 * wrap freely without having to know what Avatar already does.
 */
const InsideHoverCard = createContext(false);

type Side = 'below' | 'above' | 'right' | 'left';

interface Placement {
  left: number;
  top: number;
  side: Side;
  origin: string;
}

/**
 * Prefer below the anchor, then above, then beside it (right, left); when
 * nothing fits (a short phone viewport) take the roomier vertical side. Always
 * clamped inside the viewport with a 12 px margin. `origin` points the
 * entrance scale back at the anchor.
 */
function placeCard(r: DOMRect, w: number, h: number): Placement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampX = (x: number) => Math.max(EDGE, Math.min(x, vw - EDGE - w));
  const clampY = (y: number) => Math.max(EDGE, Math.min(y, vh - EDGE - h));
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;

  const vertical = (side: 'below' | 'above', top: number): Placement => {
    const left = clampX(cx - w / 2);
    const t = clampY(top);
    return { left, top: t, side, origin: `${Math.round(cx - left)}px ${side === 'below' ? 0 : h}px` };
  };
  const horizontal = (side: 'right' | 'left', left: number): Placement => {
    const top = clampY(cy - h / 2);
    return { left, top, side, origin: `${side === 'right' ? 0 : w}px ${Math.round(cy - top)}px` };
  };

  if (r.bottom + GAP + h <= vh - EDGE) return vertical('below', r.bottom + GAP);
  if (r.top - GAP - h >= EDGE) return vertical('above', r.top - GAP - h);
  if (r.right + GAP + w <= vw - EDGE) return horizontal('right', r.right + GAP);
  if (r.left - GAP - w >= EDGE) return horizontal('left', r.left - GAP - w);
  return vh - r.bottom >= r.top ? vertical('below', r.bottom + GAP) : vertical('above', r.top - GAP - h);
}

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function UserHoverCard({
  handle,
  children,
  className,
}: {
  handle: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<{ handle: string; view: ProfileCardView } | null>(null);
  const [Card, setCard] = useState<CardComponent | null>(() => cardModule);
  const [place, setPlace] = useState<Placement | null>(null);
  const [host, setHost] = useState<Element | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const anchorRectRef = useRef<DOMRect | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const openRef = useRef(false);
  /** Pointer over the anchor or the card: a focus loss must not close it under the mouse. */
  const pointerInside = useRef(false);
  /** Opened from the keyboard and focus is still on the host or inside the card. */
  const keyboardOpen = useRef(false);
  const focusHost = useRef<FocusHost | null>(null);
  /** Bumped per open: only the newest open's fetch may write `loaded` or close the card. */
  const request = useRef(0);
  const id = useId();
  const nested = useContext(InsideHoverCard);
  const reduce = useReducedMotion();
  // Read the context rather than useSession(): same value, minus the dev-mode
  // throw if a card ever renders outside <SessionProvider>.
  const session = useContext(SessionContext);
  const viewerId = session?.data?.user?.id ?? null;
  const enabled = !nested && !!handle && session?.status !== 'unauthenticated';

  openRef.current = open;

  const clearTimers = useCallback(() => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const close = useCallback(() => {
    clearTimers();
    keyboardOpen.current = false;
    // The panel may unmount under a resting pointer (Esc, a link inside it) and
    // never fire mouseleave; a stale "inside" would keep a later card open.
    pointerInside.current = false;
    setOpen(false);
  }, [clearTimers]);

  // Signing out (or a viewer change mid-hover) closes whatever is open.
  useEffect(() => {
    if (!enabled) close();
  }, [enabled, close]);

  const setAnchor = (r: DOMRect) => {
    anchorRectRef.current = r;
    setAnchorRect(r);
  };

  /** Start the card chunk as soon as there is intent, so it is ready by the time the delay fires. */
  const warm = useCallback(() => {
    if (cardModule) return;
    void loadCardModule().then((c) => {
      if (c) setCard(() => c);
    });
  }, []);

  const show = useCallback(() => {
    if (!enabled) return;
    clearTimers();
    warm();
    openTimer.current = window.setTimeout(() => {
      const el = anchorRef.current;
      if (!el) return;
      const hit = freshCardEntry(handle, viewerId);
      // A remembered "no such member": nothing to open.
      if (hit && !hit.view) return;
      // Fullscreen first: a card opened from a fullscreened reader must portal
      // INTO the fullscreen element or the top layer hides it.
      setHost(document.fullscreenElement ?? document.body);
      setAnchor(el.getBoundingClientRect());
      setPlace(null);
      // A cache miss means the view this component still holds is expired or was
      // invalidated (the member saved a new card, replaced the photo — whose old
      // file is gone). Opening on it would flash the old card, or a broken image,
      // until the refetch lands: show the skeleton instead. An already-OPEN card
      // (the pointer came back within the close delay) keeps what the viewer is
      // looking at — the same person — until the fresh view swaps in.
      if (hit?.view) setLoaded({ handle, view: hit.view });
      else if (!openRef.current) setLoaded(null);
      setOpen(true);
      const req = ++request.current;
      void Promise.all([loadCardView(handle, viewerId), loadCardModule()]).then(([data, comp]) => {
        // A later open started its own fetch (possibly after an invalidation):
        // this older answer must neither overwrite its view nor close its card.
        if (req !== request.current) return;
        // No card to show — a deactivated account, a network blip, a chunk that
        // failed to load. Close rather than leaving a skeleton hanging forever.
        if (!data || !comp) {
          close();
          return;
        }
        setCard(() => comp);
        setLoaded({ handle, view: data });
      });
    }, OPEN_DELAY);
  }, [enabled, handle, viewerId, clearTimers, warm, close]);

  const hide = useCallback(() => {
    clearTimers();
    closeTimer.current = window.setTimeout(() => {
      // Keyboard focus is still with this card: the pointer wandering off is not a close.
      if (keyboardOpen.current) return;
      setOpen(false);
    }, CLOSE_DELAY);
  }, [clearTimers]);

  /** Focus left the host and the card: close unless the mouse is still resting on them. */
  const focusLeft = useCallback(() => {
    keyboardOpen.current = false;
    if (!pointerInside.current) close();
  }, [close]);

  const focusHostTarget = () => focusHost.current?.target.focus({ preventScroll: true });

  // Place after measuring the real panel (skeleton first, then the card — a
  // reflective card is taller than the skeleton). The ResizeObserver catches a
  // size change that no state here describes (the lazy chunk's stylesheet).
  const shownView = loaded && loaded.handle === handle ? loaded.view : null;
  const measure = useCallback(() => {
    const panel = panelRef.current;
    const r = anchorRectRef.current;
    if (!panel || !r) return;
    const next = placeCard(r, panel.offsetWidth, panel.offsetHeight);
    setPlace((prev) =>
      prev && prev.left === next.left && prev.top === next.top && prev.side === next.side ? prev : next,
    );
  }, []);

  useIsomorphicLayoutEffect(() => {
    if (open) measure();
  }, [open, anchorRect, shownView, Card, measure]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(panel);
    return () => ro.disconnect();
  }, [open, measure]);

  // Follow the anchor while the page scrolls; close once it leaves the screen.
  // Esc closes this layer only (a drawer or lightbox around it stays) and gives
  // focus back to the host when it was inside the card.
  useEffect(() => {
    if (!open) return;
    let raf: number | null = null;
    const track = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const el = anchorRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) {
          close();
          return;
        }
        setAnchor(r);
      });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const inCard = !!panelRef.current?.contains(document.activeElement);
      e.stopPropagation();
      close();
      if (inCard) focusHostTarget();
    };
    window.addEventListener('scroll', track, true);
    window.addEventListener('resize', track);
    document.addEventListener('keydown', onKey);
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', track, true);
      window.removeEventListener('resize', track);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  // Keyboard host: native listeners, because the host is usually an ANCESTOR
  // link (focus events never travel down into this wrapper).
  useEffect(() => {
    const anchor = anchorRef.current;
    if (!enabled || !anchor) return;
    const found = resolveFocusHost(anchor, handle);
    focusHost.current = found;
    if (!found) return;
    const { listen } = found;
    const onFocusIn = (e: FocusEvent) => {
      // Shift+Tab back out of the card: it is already open.
      if (panelRef.current?.contains(e.relatedTarget as Node | null)) return;
      const t = e.target as HTMLElement;
      if (!t.matches?.(':focus-visible')) return;
      focusHost.current = { listen, target: t };
      keyboardOpen.current = true;
      show();
    };
    const onFocusOut = (e: FocusEvent) => {
      const to = e.relatedTarget as Node | null;
      if (to && (listen.contains(to) || panelRef.current?.contains(to))) return;
      if (!openRef.current) {
        clearTimers(); // tabbed past before the intent delay fired
        keyboardOpen.current = false;
        return;
      }
      focusLeft();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.shiftKey || !openRef.current) return;
      const panel = panelRef.current;
      const first = panel ? tabbables(panel)[0] : undefined;
      if (!first) return;
      e.preventDefault();
      keyboardOpen.current = true;
      first.focus();
    };
    listen.addEventListener('focusin', onFocusIn);
    listen.addEventListener('focusout', onFocusOut);
    listen.addEventListener('keydown', onKeyDown);
    return () => {
      listen.removeEventListener('focusin', onFocusIn);
      listen.removeEventListener('focusout', onFocusOut);
      listen.removeEventListener('keydown', onKeyDown);
      focusHost.current = null;
    };
  }, [enabled, handle, show, focusLeft, clearTimers]);

  // Announce the relationship on the focused host while the card is open; only
  // attributes this component added are removed again.
  useEffect(() => {
    const target = focusHost.current?.target;
    if (!open || !target) return;
    const added: string[] = [];
    if (!target.hasAttribute('aria-controls')) {
      target.setAttribute('aria-controls', id);
      added.push('aria-controls');
    }
    if (!target.hasAttribute('aria-expanded')) {
      target.setAttribute('aria-expanded', 'true');
      added.push('aria-expanded');
    }
    return () => added.forEach((a) => target.removeAttribute(a));
  }, [open, id]);

  /** Tab past the card's last stop continues after the host; Shift+Tab from its first returns to it. */
  const onPanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !focusHost.current) return;
    const panel = panelRef.current;
    const items = panel ? tabbables(panel) : [];
    if (!items.length) return;
    const active = document.activeElement;
    if (e.shiftKey && active === items[0]) {
      e.preventDefault();
      e.stopPropagation();
      focusHostTarget();
    } else if (!e.shiftKey && active === items[items.length - 1]) {
      e.preventDefault();
      e.stopPropagation();
      const { listen } = focusHost.current;
      const order = tabbables(document.body).filter((el) => !panel?.contains(el));
      let last = -1;
      order.forEach((el, i) => {
        if (el === listen || listen.contains(el)) last = i;
      });
      close();
      (order[last + 1] ?? focusHost.current.target).focus();
    }
  };

  const onPanelBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    const to = e.relatedTarget as Node | null;
    if (to && (panelRef.current?.contains(to) || focusHost.current?.listen.contains(to))) return;
    focusLeft();
  };

  return (
    <InsideHoverCard.Provider value>
      <span
        ref={anchorRef}
        className={className}
        onMouseEnter={
          enabled
            ? () => {
                pointerInside.current = true;
                show();
              }
            : undefined
        }
        onMouseLeave={
          enabled
            ? () => {
                pointerInside.current = false;
                hide();
              }
            : undefined
        }
      >
        {children}
      </span>
      {/* PORTALED, like DeptTag's tooltip and ImageLightbox — for two reasons, and
          both are real bugs seen in the browser, not theory. An ancestor with
          `opacity` (a fading-in Reveal, a muted row) applies to its whole subtree,
          so an in-flow card renders translucent with the page bleeding through it;
          an ancestor with `transform` (card-hover) becomes the containing block for
          `fixed`, so the card lands at the wrong place entirely. Placement is in
          viewport coordinates, so moving the node to <body> needs no math change.
          React events still bubble to this component through the React TREE — the
          card's own mouseenter keeps it open while the pointer is over it, and
          so does a badge popover portaled out of the card (it is a React child).
          That same bubbling is why the root STOPS click propagation (never
          preventDefault — the card's own links must still navigate): the avatar
          often sits inside a whole-card <Link> (SkillCard, VoteCard) or a toggle
          button, and a click on the card's photo would otherwise reach it.
          z-[105]: above the z-[100] lightbox / z-[90–96] drawer family it opens
          from, below the z-[110] dialogs, the z-[115] badge popover it hosts and
          the z-[120] toaster. */}
      {enabled && host
        ? createPortal(
            <AnimatePresence>
              {open && (
                <motion.div
                  key="hover-card"
                  ref={panelRef}
                  id={id}
                  role="dialog"
                  aria-label={shownView?.displayName ?? handle}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={onPanelKeyDown}
                  onBlur={onPanelBlur}
                  onMouseEnter={() => {
                    pointerInside.current = true;
                    clearTimers();
                  }}
                  onMouseLeave={() => {
                    pointerInside.current = false;
                    hide();
                  }}
                  initial={reduce ? false : { opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1, transition: { duration: 0.16, ease: EASE_OUT } }}
                  exit={{ opacity: 0, transition: { duration: reduce ? 0 : 0.12, ease: EASE_OUT } }}
                  style={{
                    left: place?.left ?? 0,
                    top: place?.top ?? 0,
                    width: CARD_WIDTH[SIZE],
                    transformOrigin: place?.origin,
                    // The first commit measures at 0,0 invisibly; the layout
                    // effect places it before the browser paints.
                    visibility: place ? 'visible' : 'hidden',
                  }}
                  className="fixed z-[105]"
                >
                  {shownView && Card ? (
                    <Card view={shownView} size={SIZE} playMedia={open} />
                  ) : (
                    <ProfileCardSkeleton size={SIZE} className="shadow-2xl" />
                  )}
                </motion.div>
              )}
            </AnimatePresence>,
            host,
          )
        : null}
    </InsideHoverCard.Provider>
  );
}
