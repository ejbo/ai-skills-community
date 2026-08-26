'use client';

import { Sparkles, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** Tiny per-field affordance: a small ✦AI chip beside a field label. */
export function AiFieldButton({
  onClick,
  loading = false,
  disabled = false,
  label = 'AI',
  title,
}: {
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  label?: string;
  title?: string;
}) {
  const t = useTranslations('skills_misc');
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      title={title ?? t('ai_generate_title')}
      className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-zinc-900 dark:text-zinc-50 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white/10 dark:hover:bg-white/[0.14]"
    >
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
      {label}
    </button>
  );
}

/** Prominent "fill everything" button shown above the form. */
export function AiAutofillButton({
  onClick,
  loading = false,
  disabled = false,
}: {
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations('skills_misc');
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-900 dark:border-zinc-100 bg-zinc-100 px-4 py-2.5 text-sm font-semibold text-zinc-900 dark:text-zinc-50 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-100/30 dark:bg-white/10 dark:hover:bg-white/[0.14]"
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      {t('ai_autofill_button')}
    </button>
  );
}
