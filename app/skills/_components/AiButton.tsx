'use client';

import { Sparkles, Loader2 } from 'lucide-react';

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
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      title={title ?? '用 AI 生成'}
      className="inline-flex items-center gap-1 rounded-md bg-accent-50 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-accent-600 transition hover:bg-accent-100 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-accent-500/15 dark:text-accent-300 dark:hover:bg-accent-500/25"
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
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="flex w-full items-center justify-center gap-2 rounded-xl border border-accent-100 bg-accent-50 px-4 py-2.5 text-sm font-semibold text-accent-600 transition hover:bg-accent-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-accent-500/30 dark:bg-accent-500/10 dark:text-accent-300 dark:hover:bg-accent-500/20"
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      AI 一键补全空字段
    </button>
  );
}
