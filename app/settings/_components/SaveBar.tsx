'use client';

// Save bar for the settings editors that save as ONE request (个人资料, 名片,
// 主页板块). It is always in the layout at the end of the form — mounting it
// only once dirty would shift the page under the cursor. Clean, it rests there
// quietly ("all saved"); dirty, it turns `sticky` (which keeps its flow slot, so
// nothing moves) and docks to the viewport bottom with an ink dot and enabled
// 保存 / 放弃更改, so the action is reachable from anywhere in a long form.
// Opaque on purpose: a backdrop blur over a live card preview is a repaint per
// scroll frame for nothing.

import { Check, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { BTN_GHOST, BTN_PRIMARY } from './ui';

export function SaveBar({
  dirty,
  saving,
  onSave,
  onDiscard,
  disabled = false,
  note,
  className = '',
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard?: () => void;
  /** Blocks 保存 even when dirty (e.g. an upload still running). */
  disabled?: boolean;
  /** Replaces the status text (e.g. "请修正标红的链接"). */
  note?: string | null;
  className?: string;
}) {
  const t = useTranslations('settings');
  return (
    <div
      className={`${dirty ? 'sticky bottom-3 z-30' : 'relative'} mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border px-4 py-2.5 transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none ${
        dirty
          ? 'border-zinc-300 bg-white shadow-[0_8px_30px_-12px_rgba(0,0,0,0.25)] dark:border-zinc-700 dark:bg-zinc-950 dark:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.8)]'
          : 'border-zinc-200 bg-white/95 dark:border-zinc-800 dark:bg-zinc-950/95'
      } ${className}`}
    >
      <p className="flex min-w-0 items-center gap-2 text-xs" aria-live="polite">
        {dirty ? (
          <>
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inset-0 rounded-full bg-zinc-900 motion-safe:animate-ping motion-safe:opacity-40 dark:bg-zinc-100" />
              <span className="relative h-2 w-2 rounded-full bg-zinc-900 dark:bg-zinc-100" />
            </span>
            <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">{note || t('pf_unsaved')}</span>
          </>
        ) : (
          <>
            <Check className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
            <span className="truncate text-muted">{note || t('pf_all_saved')}</span>
          </>
        )}
      </p>
      <div className="ml-auto flex items-center gap-1.5">
        {onDiscard && dirty && (
          <button type="button" onClick={onDiscard} disabled={saving} className={BTN_GHOST}>
            {t('pf_discard')}
          </button>
        )}
        <button type="button" onClick={onSave} disabled={!dirty || saving || disabled} className={BTN_PRIMARY}>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t('save')}
        </button>
      </div>
    </div>
  );
}
