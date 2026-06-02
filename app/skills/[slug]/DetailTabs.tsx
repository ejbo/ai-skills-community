'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';

type Tab = 'overview' | 'files' | 'versions' | 'reviews' | 'composition' | 'try_it' | 'manage';

export function DetailTabs({
  slug,
  current,
  hasVersions,
  showManage = false,
  pendingCount = 0,
}: {
  slug: string;
  current: Tab;
  hasVersions: boolean;
  showManage?: boolean;
  pendingCount?: number;
}) {
  const t = useTranslations('detail.tabs');
  const tabs: Tab[] = ['overview', 'files', 'versions', 'reviews', 'composition', 'try_it'];
  if (showManage) tabs.push('manage');

  return (
    <div className="flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map((tab) => {
        const active = tab === current;
        const href = tab === 'overview' ? `/skills/${slug}` : `/skills/${slug}?tab=${tab}`;
        const label = tab === 'manage' ? '管理' : t(tab);
        return (
          <Link
            key={tab}
            href={href}
            className={`relative shrink-0 px-4 py-2.5 text-sm font-medium transition ${
              active ? 'text-zinc-900 dark:text-white' : 'text-muted hover:text-zinc-700 dark:hover:text-zinc-200'
            }`}
          >
            {label}
            {tab === 'versions' && hasVersions && (
              <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-accent-500" />
            )}
            {tab === 'manage' && pendingCount > 0 && (
              <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-danger" />
            )}
            {active && (
              <motion.span
                layoutId="detailTab"
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
