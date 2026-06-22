'use client';

import { useEffect, useRef } from 'react';

// Counts a view every time the user opens the video page (navigates in). No
// per-user dedupe by design — each open counts once. Ref-guarded so React strict
// mode's double-invoke in dev doesn't double-count a single mount.
export function ViewPing({ slug }: { slug: string }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    fetch(`/api/videos/${slug}/view`, { method: 'POST', keepalive: true }).catch(() => {
      /* best-effort */
    });
  }, [slug]);
  return null;
}
