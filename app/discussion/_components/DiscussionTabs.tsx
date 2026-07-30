'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';

type Tab = 'posts' | 'forum';

/** URL-param tabs for the Discussion hub — same pattern as SourceTabs. */
export function DiscussionTabs() {
  const t = useTranslations('discussion');
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const current: Tab = params.get('tab') === 'forum' ? 'forum' : 'posts';

  const tabs: { key: Tab; label: string }[] = [
    { key: 'posts', label: t('tab_posts') },
    { key: 'forum', label: t('tab_forum') },
  ];

  function select(key: Tab) {
    const sp = new URLSearchParams(params.toString());
    if (key === 'posts') sp.delete('tab');
    else sp.set('tab', key);
    // Tab-specific list params must not leak across tabs.
    sp.delete('page');
    sp.delete('category');
    sp.delete('sort');
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div className="flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
      {tabs.map((tab) => {
        const active = tab.key === current;
        return (
          <button
            key={tab.key}
            onClick={() => select(tab.key)}
            className={`relative shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium transition ${
              active
                ? 'text-zinc-900 dark:text-white'
                : 'text-muted hover:text-zinc-700 dark:hover:text-zinc-200'
            }`}
          >
            {tab.label}
            {active && (
              <motion.span
                layoutId="discussionTab"
                className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-accent-500"
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
