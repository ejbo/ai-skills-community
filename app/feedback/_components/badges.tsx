import type { FeedbackCategory, FeedbackStatus } from '@prisma/client';

// Single source of truth for status/category labels + colors, shared by the
// list filter chips, the badges, and the admin status control.

export const STATUS_META: Record<FeedbackStatus, { label: string; className: string }> = {
  open: {
    label: '待处理',
    className: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  },
  planned: {
    label: '已计划',
    className: 'bg-accent-500/10 text-accent-600 dark:text-accent-300',
  },
  in_progress: {
    label: '处理中',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  },
  done: {
    label: '已完成',
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
  declined: {
    label: '不采纳',
    className: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  },
};

export const CATEGORY_META: Record<FeedbackCategory, { label: string; className: string }> = {
  feature: {
    label: '功能建议',
    className: 'border-accent-200 text-accent-600 dark:border-accent-500/30 dark:text-accent-300',
  },
  bug: {
    label: '问题反馈',
    className: 'border-rose-200 text-rose-600 dark:border-rose-500/30 dark:text-rose-300',
  },
  other: {
    label: '其他',
    className: 'border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400',
  },
};

export function StatusBadge({ status }: { status: FeedbackStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}

export function CategoryChip({ category }: { category: FeedbackCategory }) {
  const meta = CATEGORY_META[category];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}
