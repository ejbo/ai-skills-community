'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

export function VisitTracker({ enabled }: { enabled: boolean }) {
  const pathname = usePathname();

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch('/api/internal/page-visit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: pathname }),
      keepalive: true,
      signal: controller.signal,
    }).catch(() => undefined);
    return () => controller.abort();
  }, [pathname, enabled]);

  return null;
}
