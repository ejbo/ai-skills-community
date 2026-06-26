'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';

// Client chrome around the (server-rendered) nav header:
//   - `.container` makes the bar align edge-to-edge with every content section
//     below (same max-width + gutter), so it reads as one consistent column.
//   - Auto-hide: slide the bar up when the reader scrolls down (gets out of the
//     way of content) and bring it back the moment they scroll up.
export function NavBarShell({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
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
