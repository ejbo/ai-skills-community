'use client';

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';

type Source = 'all' | 'external' | 'curated' | 'internal' | 'packs';

export function SourceTabs() {
  const t = useTranslations('browse');
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const current = (params.get('source') as Source) || 'all';

  const tabs: { key: Source; label: string }[] = [
    { key: 'all', label: t('all') },
    { key: 'external', label: t('external') },
    { key: 'curated', label: t('curated') },
    { key: 'internal', label: t('internal') },
    // Not a SourceType — flips the browse page into the skill-pack grid.
    { key: 'packs', label: t('packs') },
  ];

  function select(key: Source) {
    const sp = new URLSearchParams(params.toString());
    if (key === 'all') sp.delete('source');
    else sp.set('source', key);
    sp.delete('page');
    router.push(`${pathname}?${sp.toString()}`, { scroll: false });
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
              active ? 'text-zinc-900 dark:text-white' : 'text-muted hover:text-zinc-700 dark:hover:text-zinc-200'
            }`}
          >
            {tab.label}
            {active && (
              <motion.span
                layoutId="sourceTab"
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
