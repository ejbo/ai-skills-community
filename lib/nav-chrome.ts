// Main-navbar visibility hold — a tiny external store (reader-prefs pattern).
// A page can ask the global NavBarShell to STAY hidden while one of its own
// sticky bars is pinned to the top (the vote gallery toolbar): otherwise the
// scroll-up reveal stacks the navbar on top of that bar and both cover the
// content. Holds are counted so nested/overlapping holders compose; each
// holder releases exactly once via the returned function.

import { useSyncExternalStore } from 'react';

let holds = 0;
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

/** Hide the main navbar until the returned release is called. Idempotent release. */
export function holdNavBarHidden(): () => void {
  holds += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
    emit();
  };
}

const getSnapshot = () => holds > 0;
const getServerSnapshot = () => false;

/** True while any page holds the navbar hidden. */
export function useNavBarHeldHidden(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
