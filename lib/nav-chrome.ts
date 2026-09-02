// Main-navbar visibility coordination — a tiny external store (reader-prefs
// pattern), read by `components/NavBarShell.tsx` and written by pages.
//
// Three things live here, on purpose in one module so their precedence is
// spelled out once:
//   - HIDDEN holds: a page asks the auto-hiding navbar to STAY hidden while one
//     of its own sticky bars is pinned to the top (the vote gallery toolbar,
//     the 技术专区 composer, the docked panel's expand / maximize modes) —
//     otherwise the scroll-up reveal stacks the navbar on that bar.
//   - VISIBLE holds: the docked reading panel keeps the navbar VISIBLE while it
//     is open (search / avatar / bell stay reachable beside the panel, and the
//     panel's top offset is a constant instead of a bobbing rail).
//   - The resolved visibility, published by NavBarShell alone (`setNavBarVisible`),
//     for any surface that has to follow the bar's slide, alongside the
//     `--nav-offset` CSS variable NavBarShell writes next to it. Nothing
//     consumes either today: the帖子 scroll strip that did was removed (a second
//     sticky bar over an article is chrome the reader did not ask for). Both are
//     kept because they are the only correct way to follow the bar — a new
//     surface must read them rather than re-derive scroll direction.
// Precedence, in NavBarShell: `hidden = heldHidden || (autoHidden && !heldVisible)`
// — an explicit hide always wins over a visible hold. Holds are counted so
// nested / overlapping holders compose; each release is idempotent.

import { useSyncExternalStore } from 'react';

/** `pt-3` (12) + `h-14` (56): the strip the bar occupies when visible. */
export const NAV_BAR_HEIGHT_PX = 68;

let hiddenHolds = 0;
let visibleHolds = 0;
let visible = true;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function counted(inc: () => void, dec: () => void): () => void {
  inc();
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    dec();
    emit();
  };
}

/** Hide the main navbar until the returned release is called. Idempotent release. */
export function holdNavBarHidden(): () => void {
  return counted(
    () => {
      hiddenHolds += 1;
    },
    () => {
      hiddenHolds = Math.max(0, hiddenHolds - 1);
    },
  );
}

/** Keep the main navbar visible (no auto-hide) until released. A hidden hold still wins. */
export function holdNavBarVisible(): () => void {
  return counted(
    () => {
      visibleHolds += 1;
    },
    () => {
      visibleHolds = Math.max(0, visibleHolds - 1);
    },
  );
}

const getHeldHidden = () => hiddenHolds > 0;
const getHeldVisible = () => visibleHolds > 0;
const getVisible = () => visible;
const serverFalse = () => false;
const serverTrue = () => true;

/** True while any page holds the navbar hidden. */
export function useNavBarHeldHidden(): boolean {
  return useSyncExternalStore(subscribe, getHeldHidden, serverFalse);
}

/** True while any surface holds the navbar visible. */
export function useNavBarHeldVisible(): boolean {
  return useSyncExternalStore(subscribe, getHeldVisible, serverFalse);
}

/** Written ONLY by NavBarShell after it resolves holds + auto-hide. */
export function setNavBarVisible(next: boolean): void {
  if (visible === next) return;
  visible = next;
  emit();
}

/** The bar's resolved visibility (server snapshot: visible). */
export function useNavBarVisible(): boolean {
  return useSyncExternalStore(subscribe, getVisible, serverTrue);
}
