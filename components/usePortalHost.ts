'use client';

// Where a portal must land so it stays VISIBLE: while an element is fullscreen
// the browser paints it in the top layer, above everything portaled to
// <body> — a toast, lightbox or menu mounted on body simply vanishes. Consumers
// render into `document.fullscreenElement ?? document.body` and re-evaluate on
// every `fullscreenchange` (+ the WebKit-prefixed twin). `null` before mount,
// so SSR and the first client render agree (render nothing until then).
// `DeptTag` / `UserHoverCard` / `useAnchoredPanel` already do the equivalent
// inline; this is the shared form for new consumers (Toaster, lightboxes).

import { useEffect, useState } from 'react';

type FsDocument = Document & { webkitFullscreenElement?: Element | null };

function currentHost(): Element {
  const doc = document as FsDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? document.body;
}

export function usePortalHost(): Element | null {
  const [host, setHost] = useState<Element | null>(null);
  useEffect(() => {
    const sync = () => setHost(currentHost());
    sync();
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);
  return host;
}
