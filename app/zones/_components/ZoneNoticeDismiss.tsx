'use client';

// 技术专区 — the ✕ on the 版主公告 band. Writes the basePath-scoped dismissal
// cookie (lib/zones/notice-cookie.ts) and asks the RSC to re-render; the band
// is then simply not in the next payload. No exit tween on purpose — a height
// collapse would fight the refresh that removes the node.

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { noticeCookieHeader, readNoticeCookie, withNoticeDismissed } from '@/lib/zones/notice-cookie';
import { BTN_ICON } from './ui';

export function ZoneNoticeDismiss({ zoneId, postId, className = '' }: { zoneId: string; postId: string; className?: string }) {
  const t = useTranslations('zones');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function dismiss() {
    // NEXT_PUBLIC_* is inlined at build time — the same source `withBasePath` uses.
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
    document.cookie = noticeCookieHeader(withNoticeDismissed(readNoticeCookie(document.cookie), zoneId, postId), basePath);
    startTransition(() => router.refresh());
  }

  return (
    <button
      type="button"
      onClick={dismiss}
      disabled={pending}
      aria-label={t('notice_dismiss')}
      title={t('notice_dismiss')}
      className={`${BTN_ICON} ${className}`}
    >
      <X className="h-4 w-4" />
    </button>
  );
}
