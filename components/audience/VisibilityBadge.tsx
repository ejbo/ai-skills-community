'use client';

// Quiet 可见范围 badge — renders nothing for `public`. Only ever shown to people who can
// see the item anyway (its owner, a manager, someone on its list), so it states a fact
// to them; it is never a teaser to outsiders. Ink-only chrome, no accent colour.

import { useTranslations } from 'next-intl';
import { EyeOff, Users } from 'lucide-react';
import type { ContentVisibility } from '@/lib/audience-shared';

export function VisibilityBadge({
  visibility,
  tone = 'default',
  className = '',
}: {
  visibility: ContentVisibility;
  /** `onMedia` = over a cover image (dark translucent pill). */
  tone?: 'default' | 'onMedia';
  className?: string;
}) {
  const t = useTranslations('audience');
  if (visibility === 'public') return null;
  const Icon = visibility === 'private' ? EyeOff : Users;
  const cls =
    tone === 'onMedia'
      ? 'bg-zinc-900/80 text-white'
      : 'border border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cls} ${className}`}
      title={t(`opt_${visibility}_hint`)}
    >
      <Icon className="h-3 w-3" />
      {t(`badge_${visibility}`)}
    </span>
  );
}
