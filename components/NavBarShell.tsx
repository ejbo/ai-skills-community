'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { NAV_BAR_HEIGHT_PX, setNavBarVisible, useNavBarHeldHidden, useNavBarHeldVisible } from '@/lib/nav-chrome';

// Client chrome around the (server-rendered) nav header:
//   - `.container` makes the bar align edge-to-edge with every content section
//     below (same max-width + gutter), so it reads as one consistent column.
//   - Auto-hide: slide the bar up when the reader scrolls down (gets out of the
//     way of content) and bring it back the moment they scroll up.
//   - A page can HOLD it hidden (lib/nav-chrome.ts) while its own sticky bar
//     is pinned to the top, so the scroll-up reveal never stacks on that bar;
//     the docked reading panel HOLDS it visible instead, so the bar stays
//     usable beside the panel. `hidden = heldHidden || (autoHidden && !heldVisible)`
//     — an explicit hide (expand / maximize / composer) beats a visible hold.
//   - The resolved state is published back (`setNavBarVisible`) and mirrored
//     into `--nav-offset` on <html> for the ONE consumer that must follow the
//     bar's slide (PostContextStrip). Rails, the dock and the TOC use constant
//     offsets and never move on scroll reversal.
export function NavBarShell({ children }: { children: ReactNode }) {
  const [autoHidden, setHidden] = useState(false);
  const heldHidden = useNavBarHeldHidden();
  const heldVisible = useNavBarHeldVisible();
  const hidden = heldHidden || (autoHidden && !heldVisible);
  const lastY = useRef(0);
  const ticking = useRef(false);

  useEffect(() => {
    lastY.current = window.scrollY;
    function onScroll() {
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const delta = y - lastY.current;
        // Always reveal near the top; ignore sub-pixel jitter elsewhere.
        if (y < 80 || delta < -6) setHidden(false);
        else if (delta > 6) setHidden(true);
        lastY.current = y;
        ticking.current = false;
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setNavBarVisible(!hidden);
    document.documentElement.style.setProperty('--nav-offset', hidden ? '0px' : `${NAV_BAR_HEIGHT_PX}px`);
  }, [hidden]);

  return (
    <div
      className={`sticky top-0 z-40 pt-3 transition-transform duration-300 ease-out ${
        hidden ? '-translate-y-[140%]' : 'translate-y-0'
      }`}
    >
      <div className="container">{children}</div>
    </div>
  );
}
