'use client';

import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

export function SearchTrigger() {
  const router = useRouter();
  const t = useTranslations('nav');
  const [isMac, setIsMac] = useState(true);

  useEffect(() => {
    setIsMac(navigator.platform.toLowerCase().includes('mac'));
    function handler(e: KeyboardEvent) {
      const meta = isMac ? e.metaKey : e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        router.push('/skills');
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [router, isMac]);

  return (
    <button
      onClick={() => router.push('/skills')}
      className="flex h-9 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:text-zinc-200 md:min-w-[200px]"
    >
      <Search className="h-3.5 w-3.5" />
      <span className="hidden md:inline">{t('search_placeholder')}</span>
      <kbd className="ml-auto hidden rounded border border-zinc-200 px-1.5 text-[10px] font-mono text-zinc-500 dark:border-zinc-700 md:inline">
        {isMac ? '⌘' : 'Ctrl'} K
      </kbd>
    </button>
  );
}
