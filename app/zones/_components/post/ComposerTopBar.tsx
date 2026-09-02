'use client';

// The composer's own chrome: a 48 px sticky bar that REPLACES the global
// navbar while the page is mounted (`holdNavBarHidden()` — the page is the
// editor, one bar is enough). Left: ← · zone name · 草稿/已发布 chip · 本地已
// 自动保存; right: ⚙ 设置 (below xl, where the settings sheet is a drawer; a dot
// marks a required field still missing) · 保存草稿 · 发布 (Magnetic +
// StatefulButton with `skipDone` — a navigation follows). While uploads are
// in flight the actions are disabled and the reason is spelled out inline.

import { useEffect } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft, Loader2, Settings2 } from 'lucide-react';
import { Magnetic } from '@/components/motion';
import { StatefulButton } from '@/components/motion/StatefulButton';
import { relativeTime } from '@/lib/i18n-date';
import { NAV_BAR_HEIGHT_PX, holdNavBarHidden } from '@/lib/nav-chrome';
import { BTN_ICON, PILL_MONO } from '@/app/zones/_components/ui';

export function ComposerTopBar({
  backHref,
  zoneName,
  published,
  autosavedAt,
  uploading,
  settingsIncomplete,
  onOpenSettings,
  saveLabel,
  publishLabel,
  onSaveDraft,
  onPublish,
  disabled,
}: {
  backHref: string;
  zoneName: string;
  published: boolean;
  autosavedAt: string | null;
  /** In-flight uploads (ledger + body) — actions wait for them. */
  uploading: number;
  settingsIncomplete: boolean;
  onOpenSettings: () => void;
  saveLabel: string;
  publishLabel: string;
  onSaveDraft: () => Promise<boolean>;
  onPublish: () => Promise<boolean>;
  disabled: boolean;
}) {
  const t = useTranslations('zones');
  const locale = useLocale();

  // Hold the global navbar hidden for the life of the composer; the returned
  // release is the effect cleanup (counted holds, idempotent).
  useEffect(() => holdNavBarHidden(), []);

  const blocked = disabled || uploading > 0;

  return (
    <div
      className="sticky top-0 z-30 -mx-6 flex h-12 items-center gap-2 border-b border-zinc-200 bg-[rgb(var(--bg))] px-6 dark:border-zinc-800 sm:gap-3"
      // The held-hidden navbar slides away but its 68 px slot stays in flow; pull
      // the bar up into that slot (the dock does the same) or the composer opens
      // on a blank strip.
      style={{ marginTop: -NAV_BAR_HEIGHT_PX }}
    >
      <Link href={backHref} aria-label={t('composer_back')} title={t('composer_back')} className={BTN_ICON}>
        <ArrowLeft className="h-4 w-4" />
      </Link>
      <span className="min-w-0 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{zoneName}</span>
      {/* Phones keep ← · name · ⚙ · 发布 only (the chip would squeeze the name out). */}
      <span className={`${PILL_MONO} hidden sm:inline-flex`}>{published ? t('composer_status_published') : t('composer_status_draft')}</span>
      {autosavedAt && (
        // suppressHydrationWarning must sit on the TEXT-ONLY node — the relative
        // time ticks over between SSR and hydration.
        <span className="hidden truncate text-[11px] text-muted md:inline" suppressHydrationWarning>
          {t('composer_autosaved', { time: relativeTime(autosavedAt, locale) })}
        </span>
      )}

      <span className="ml-auto flex shrink-0 items-center gap-2">
        {uploading > 0 && (
          <span className="hidden items-center gap-1.5 text-xs text-muted sm:inline-flex">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t('composer_wait_uploads', { count: uploading })}
          </span>
        )}
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label={t('composer_settings')}
          title={settingsIncomplete ? t('composer_settings_incomplete') : t('composer_settings')}
          className={`${BTN_ICON} relative xl:hidden`}
        >
          <Settings2 className="h-4 w-4" />
          {settingsIncomplete && <span aria-hidden className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-zinc-900 dark:bg-zinc-100" />}
        </button>
        <span className="hidden sm:inline-block">
          <StatefulButton
            onAction={onSaveDraft}
            disabled={blocked}
            className="h-9 rounded-lg border border-zinc-300 px-4 text-sm font-medium transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:hover:border-zinc-500"
          >
            {saveLabel}
          </StatefulButton>
        </span>
        <Magnetic>
          <StatefulButton
            onAction={onPublish}
            skipDone
            disabled={blocked}
            className="h-9 rounded-lg bg-zinc-900 px-5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {publishLabel}
          </StatefulButton>
        </Magnetic>
      </span>
    </div>
  );
}
