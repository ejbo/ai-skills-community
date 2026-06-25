'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';

export type ManageSection = 'overview' | 'edit' | 'versions' | 'comparison' | 'access' | 'analytics';

const LABELS: Record<ManageSection, string> = {
  overview: '概览',
  edit: '编辑',
  versions: '版本',
  comparison: '对比',
  access: '访问申请',
  analytics: '分析',
};

const ORDER: ManageSection[] = ['overview', 'edit', 'versions', 'comparison', 'access', 'analytics'];

export function ManageNav({
  slug,
  current,
  pendingCount = 0,
  inline = false,
}: {
  slug: string;
  current: ManageSection;
  pendingCount?: number;
  /** true → links stay on the detail page's Manage tab; false → the standalone /manage page. */
  inline?: boolean;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {ORDER.map((section) => {
        const active = section === current;
        return (
          <Link
            key={section}
            href={inline ? `/skills/${slug}?tab=manage&section=${section}` : `/skills/${slug}/manage?section=${section}`}
            className={`relative shrink-0 px-4 py-2.5 text-sm font-medium transition ${
              active ? 'text-zinc-900 dark:text-white' : 'text-muted hover:text-zinc-700 dark:hover:text-zinc-200'
            }`}
          >
            {LABELS[section]}
            {section === 'access' && pendingCount > 0 && (
              <span className="ml-1.5 rounded-full bg-danger/15 px-1.5 py-0.5 text-[10px] font-semibold text-danger">
                {pendingCount}
              </span>
            )}
            {active && (
              <motion.span
                layoutId="manageTab"
                className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-accent-500"
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              />
            )}
          </Link>
        );
      })}
    </div>
  );
}
