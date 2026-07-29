import type { DiscussionCategory } from '@prisma/client';
import { Lock, Pin } from 'lucide-react';

// Single source of truth for forum category labels/colors — shared by filter
// chips, list badges and the composer's category picker (same pattern as the
// feedback board's badges.tsx).
export const CATEGORY_META: Record<DiscussionCategory, { label: string; className: string }> = {
  tech: {
    label: '技术交流',
    className: 'bg-accent-500/10 text-accent-600 dark:text-accent-300',
  },
  qa: {
    label: '问答求助',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  },
  share: {
    label: '经验分享',
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
  showcase: {
    label: '成果展示',
    className: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  },
  general: {
    label: '灌水闲聊',
    className: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  },
};

export function CategoryChip({ category }: { category: DiscussionCategory }) {
  const meta = CATEGORY_META[category];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}

export function PinnedBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-500/10 px-2 py-0.5 text-[11px] font-medium text-accent-600 dark:text-accent-300">
      <Pin className="h-3 w-3" />
      置顶
    </span>
  );
}

export function LockedBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
      <Lock className="h-3 w-3" />
      已锁定
    </span>
  );
}
