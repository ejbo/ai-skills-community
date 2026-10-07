'use client';

// 可见范围 dialog — the quick path from an item's own page (votes: the gallery header's
// 可见范围 button, most useful once an activity has ended and the owner wants it gone
// from the hub). Generic: the surface passes how to LOAD the current state (fresh on
// every open — the full editor in another tab may have changed it) and how to SAVE it.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Loader2, X } from 'lucide-react';
import { pushToast } from '@/components/Toaster';
import type { AudiencePick, ContentVisibility } from '@/lib/audience-shared';
import { VisibilityField } from './VisibilityField';

export interface VisibilityState {
  visibility: ContentVisibility;
  audience: AudiencePick[];
}

export function VisibilityDialog({
  open,
  onClose,
  load,
  save,
  selfHandle,
}: {
  open: boolean;
  onClose: () => void;
  load: () => Promise<VisibilityState | null>;
  /** Resolve true when saved (the dialog then closes and toasts). */
  save: (next: { visibility: ContentVisibility; audienceUserIds: string[] }) => Promise<boolean>;
  selfHandle?: string | null;
}) {
  const t = useTranslations('audience');
  const [state, setState] = useState<VisibilityState | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState(null);
    setFailed(false);
    load()
      .then((s) => {
        if (cancelled) return;
        if (s) setState(s);
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // `load` is a fresh closure per render on most call sites; reload only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  async function submit() {
    if (!state) return;
    setSaving(true);
    try {
      const ok = await save({
        visibility: state.visibility,
        audienceUserIds: state.audience.map((a) => a.userId),
      });
      if (ok) {
        pushToast('success', t('saved'));
        onClose();
      } else {
        pushToast('error', t('save_failed'));
      }
    } catch {
      pushToast('error', t('save_failed'));
    } finally {
      setSaving(false);
    }
  }

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('dialog_title')}
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t('dialog_title')}</h2>
          <button
            type="button"
            aria-label={t('close')}
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">{t('dialog_hint')}</p>

        <div className="mt-4 min-h-[120px]">
          {state ? (
            <VisibilityField
              visibility={state.visibility}
              onVisibilityChange={(visibility) => setState((s) => (s ? { ...s, visibility } : s))}
              audience={state.audience}
              onAudienceChange={(audience) => setState((s) => (s ? { ...s, audience } : s))}
              selfHandle={selfHandle}
              disabled={saving}
            />
          ) : failed ? (
            <p className="py-8 text-center text-sm text-muted">{t('load_failed')}</p>
          ) : (
            <div className="flex items-center justify-center py-8 text-muted">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center rounded-lg border border-zinc-200 px-3.5 text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!state || saving}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('save')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
