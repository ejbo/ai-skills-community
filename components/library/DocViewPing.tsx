'use client';

import { useEffect, useRef } from 'react';

// 打开详情页记一次浏览（同 video ViewPing：ref 防 strict-mode 双计，best-effort）。
export function DocViewPing({ docId }: { docId: string }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    fetch(`/api/library/docs/${docId}/view`, { method: 'POST', keepalive: true }).catch(() => {
      /* best-effort */
    });
  }, [docId]);
  return null;
}
