import type { FeedbackCategory, FeedbackStatus } from '@prisma/client';
import { useTranslations } from 'next-intl';

// Single source of truth for status/category colors, shared by the list filter
// chips, the badges, and the admin status control. Display labels live in the
// `feedback` message namespace (status_<value> / category_<value>).

export const STATUS_META: Record<FeedbackStatus, { className: string }> = {
  open: {
    className: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  },
  planned: {
    className: 'bg-accent-500/10 text-accent-600 dark:text-accent-300',
  },
  in_progress: {
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  },
  done: {
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
  declined: {
    className: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  },
};

export const CATEGORY_META: Record<FeedbackCategory, { className: string }> = {
  feature: {
    className: 'border-accent-200 text-accent-600 dark:border-accent-500/30 dark:text-accent-300',
  },
  bug: {
    className: 'border-rose-200 text-rose-600 dark:border-rose-500/30 dark:text-rose-300',
  },
  other: {
    className: 'border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400',
  },
};

export function StatusBadge({ status }: { status: FeedbackStatus }) {
  const t = useTranslations('feedback');
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.className}`}
    >
      {t(`status_${status}`)}
    </span>
  );
}

export function CategoryChip({ category }: { category: FeedbackCategory }) {
  const t = useTranslations('feedback');
  const meta = CATEGORY_META[category];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] ${meta.className}`}
    >
      {t(`category_${category}`)}
    </span>
  );
}
