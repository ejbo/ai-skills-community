'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { DOC_TYPES } from '@/lib/library/types';

/** 类型下划线 tab（feedback 页的 Link 版式样）：写 `?type=`，全部 = 删参。 */
export function TypeTabs() {
  const tb = useTranslations('browse');
  const tl = useTranslations('labels');
  const pathname = usePathname();
  const params = useSearchParams();
  const active = params.get('type') ?? 'all';

  const tabs = [
    { key: 'all', label: tb('all') },
    ...DOC_TYPES.map((type) => ({ key: type as string, label: tl(`docType.${type}`) })),
  ];

  function href(key: string) {
    const sp = new URLSearchParams(params.toString());
    if (key === 'all') sp.delete('type');
    else sp.set('type', key);
    sp.delete('page');
    const qs = sp.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  return (
    <div className="flex overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={href(tab.key)}
            scroll={false}
            className={`relative shrink-0 whitespace-nowrap px-3 py-2 text-sm font-medium transition ${
              isActive
                ? 'text-zinc-900 dark:text-white'
                : 'text-muted hover:text-zinc-700 dark:hover:text-zinc-200'
            }`}
          >
            {tab.label}
            {isActive && (
              <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-accent-500" />
            )}
          </Link>
        );
      })}
    </div>
  );
}
