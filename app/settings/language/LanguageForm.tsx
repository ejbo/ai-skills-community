'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { LOCALE_OPTIONS, setLocaleCookie } from '@/lib/locales';

// Same cookie + options as the navbar switcher (components/LanguageSwitcher.tsx).
export function LanguageForm({ current }: { current: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState(current);
  const [, startTransition] = useTransition();

  function choose(code: string) {
    if (code === selected) return;
    setSelected(code);
    setLocaleCookie(code);
    startTransition(() => router.refresh());
  }

  return (
    <div className="surface divide-y divide-zinc-100 rounded-2xl dark:divide-zinc-800/60">
      {LOCALE_OPTIONS.map((o) => {
        const active = o.code === selected;
        return (
          <button
            key={o.code}
            onClick={() => choose(o.code)}
            className="flex w-full items-center justify-between px-5 py-3.5 text-left text-sm transition first:rounded-t-2xl last:rounded-b-2xl hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
          >
            <span className={active ? 'font-medium' : ''}>{o.label}</span>
            {active && <Check className="h-4 w-4 text-accent-500" />}
          </button>
        );
      })}
    </div>
  );
}
