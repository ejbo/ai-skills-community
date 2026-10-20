'use client';

// 技术专区 — 保存撞上别人的新版本（PATCH 409 stale_revision，docs/contracts/reports.md §4）。
// 三个出口：看最新版本（历史页，新标签）/ 在最新版本上重做（刷新，本地草稿留在 localStorage）/
// 仍用我的版本覆盖（以服务器当前 revision 重发；被覆盖的内容仍在历史里，可恢复）。

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import type { PublicAuthor } from '@/lib/user-identity';
import { RelTime } from '../RelTime';
import { BTN_PRIMARY, BTN_SECONDARY } from '../ui';

export interface StaleInfo {
  revision: number;
  editedAt: string;
  editedBy: PublicAuthor | null;
}

export function StaleRevisionDialog({
  info,
  historyHref,
  onReload,
  onOverwrite,
  onClose,
}: {
  info: StaleInfo;
  historyHref: string;
  onReload: () => void;
  onOverwrite: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('zones');
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4" role="presentation" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="stale-title" className="surface w-full max-w-md rounded-2xl p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-zinc-500" aria-hidden />
          <div className="min-w-0">
            <h2 id="stale-title" className="text-base font-semibold">
              {t('stale_title')}
            </h2>
            <p className="mt-1 text-sm text-muted" suppressHydrationWarning>
              {t('stale_body', { who: info.editedBy?.displayName ?? t('stale_someone') })} <RelTime at={info.editedAt} />
            </p>
            <p className="mt-2 text-xs text-muted">{t('stale_hint')}</p>
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <Link href={historyHref} target="_blank" rel="noopener" className={BTN_SECONDARY}>
            {t('stale_view_latest')}
          </Link>
          <button ref={first} type="button" onClick={onReload} className={BTN_SECONDARY}>
            {t('stale_reload')}
          </button>
          <button type="button" onClick={onOverwrite} className={BTN_PRIMARY}>
            {t('stale_overwrite')}
          </button>
        </div>
      </div>
    </div>
  );
}
