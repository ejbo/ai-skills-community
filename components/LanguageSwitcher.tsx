'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Languages } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { LOCALE_OPTIONS, setLocaleCookie } from '@/lib/locales';

// Navbar language switcher. 设置 → 语言 still exists (same cookie, same helper),
// but it was too deep to be discovered — this is the visible entry point.
export function LanguageSwitcher() {
  const t = useTranslations('nav');
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const current = LOCALE_OPTIONS.find((o) => o.code === locale) ?? LOCALE_OPTIONS[0];

  function choose(code: string) {
    setOpen(false);
    if (code === locale) return;
    setLocaleCookie(code);
    // Messages are resolved server-side per request, so a refresh is the switch.
    startTransition(() => router.refresh());
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={`${t('language')}: ${current.label}`}
        title={t('language')}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex h-9 items-center gap-1 rounded-lg px-2 text-zinc-600 transition hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 ${
          pending ? 'opacity-60' : ''
        }`}
      >
        <Languages className="h-4 w-4 shrink-0" />
        {/* Label hidden on the narrowest screens — the 56px navbar row is tight. */}
        <span className="hidden text-xs font-semibold leading-none sm:inline">{current.short}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="surface absolute right-0 top-full mt-2 w-40 rounded-xl p-1 shadow-lg"
          >
            {LOCALE_OPTIONS.map((o) => {
              const active = o.code === locale;
              return (
                <button
                  key={o.code}
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => choose(o.code)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span className={active ? 'font-medium' : ''}>{o.label}</span>
                  {active && <Check className="h-4 w-4 shrink-0 text-zinc-900 dark:text-zinc-50" />}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
