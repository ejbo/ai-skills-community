import type { DiscussionCategory } from '@prisma/client';
import { useTranslations } from 'next-intl';
import { Lock, Pin } from 'lucide-react';

// Single source of truth for forum category colors — shared by filter
// chips, the sidebar, list badges and the composer's category picker (same
// pattern as the feedback board's badges.tsx). `dot` feeds the sidebar's
// Discourse-style color dot. Display labels live in the 'labels' i18n
// namespace: render tl(`discussionCategory.${category}`).
export const CATEGORY_META: Record<DiscussionCategory, { className: string; dot: string }> = {
  tech: {
    className: 'bg-accent-500/10 text-accent-600 dark:text-accent-300',
    dot: 'bg-accent-500',
  },
  models: {
    className: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
    dot: 'bg-violet-500',
  },
  agents: {
    className: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300',
    dot: 'bg-cyan-500',
  },
  skills: {
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  research: {
    className: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
    dot: 'bg-rose-500',
  },
  qa: {
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  share: {
    className: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
    dot: 'bg-sky-500',
  },
  showcase: {
    className: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
    dot: 'bg-orange-500',
  },
  general: {
    className: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
    dot: 'bg-zinc-400',
  },
};

/**
 * i18n key for a category's display label — CATEGORY_META no longer carries a
 * `label`; the Chinese/English/French strings live in the messages `labels`
 * namespace under `discussionCategory.*`. Call it with the `labels` translator:
 * `const tl = useTranslations('labels'); tl(categoryLabelKey(c))`.
 */
export function categoryLabelKey(category: DiscussionCategory): string {
  return `discussionCategory.${category}`;
}

// AI-focused set offered for NEW topics and shown in filters; `general` is a
// legacy value old rows may still carry (its chip still renders via META).
export const VISIBLE_CATEGORIES = [
  'tech',
  'models',
  'agents',
  'skills',
  'research',
  'qa',
  'share',
  'showcase',
] as const satisfies readonly DiscussionCategory[];

export function CategoryChip({ category }: { category: DiscussionCategory }) {
  const tl = useTranslations('labels');
  const meta = CATEGORY_META[category];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.className}`}
    >
      {tl(`discussionCategory.${category}`)}
    </span>
  );
}

export function PinnedBadge() {
  const t = useTranslations('discussion');
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-500/10 px-2 py-0.5 text-[11px] font-medium text-accent-600 dark:text-accent-300">
      <Pin className="h-3 w-3" />
      {t('pinned_badge')}
    </span>
  );
}

export function LockedBadge() {
  const t = useTranslations('discussion');
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
      <Lock className="h-3 w-3" />
      {t('locked_badge')}
    </span>
  );
}
