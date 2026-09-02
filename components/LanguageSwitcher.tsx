'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Languages } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  BubbleLabel,
  BubblePanel,
  BubbleRow,
  bubblePanelHeight,
  bubblePill,
  bubbleTriggerKeyDown,
} from '@/components/BubbleMenuPanel';
import { useAnchoredPanel } from '@/components/useAnchoredPanel';
import { LOCALE_OPTIONS, setLocaleCookie } from '@/lib/locales';

// Navbar language switcher. 设置 → 语言 still exists (same cookie, same helper),
// but it was too deep to be discovered — this is the visible entry point.
//
// Shares the bubble-menu motion and the portaled panel with 收纳 and the user
// menu (components/BubbleMenuPanel.tsx). The current locale is the FILLED pill,
// which is the same "active" state the other two menus use for the current
// page — the Check stays as well, because a fill alone is a weak affordance for
// a radio group.

const PANEL_W = 200;

export function LanguageSwitcher() {
  const t = useTranslations('nav');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const panel = useAnchoredPanel<HTMLButtonElement>({
    width: PANEL_W,
    height: bubblePanelHeight(LOCALE_OPTIONS.length),
  });

  const current = LOCALE_OPTIONS.find((o) => o.code === locale) ?? LOCALE_OPTIONS[0];

  function choose(code: string) {
    panel.close();
    if (code === locale) return;
    setLocaleCookie(code);
    // Messages are resolved server-side per request, so a refresh is the switch.
    startTransition(() => router.refresh());
  }

  return (
    <>
      <button
        ref={panel.triggerRef}
        type="button"
        onClick={panel.toggle}
        onKeyDown={bubbleTriggerKeyDown(panel)}
        aria-label={`${t('language')}: ${current.label}`}
        title={t('language')}
        aria-haspopup="menu"
        aria-expanded={panel.open}
        className={`flex h-9 items-center gap-1 rounded-lg px-2 text-zinc-600 transition hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:focus-visible:ring-zinc-100 ${
          pending ? 'opacity-60' : ''
        }`}
      >
        <Languages className="h-4 w-4 shrink-0" />
        {/* Label hidden on the narrowest screens — the 56px navbar row is tight. */}
        <span className="hidden text-xs font-semibold leading-none sm:inline">{current.short}</span>
      </button>

      <BubblePanel panel={panel} label={t('language')} width={PANEL_W}>
        {LOCALE_OPTIONS.map((o, i) => {
          const active = o.code === locale;
          return (
            <BubbleRow key={o.code} index={i}>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => choose(o.code)}
                className={bubblePill(active)}
              >
                <BubbleLabel index={i} className="min-w-0 flex-1 truncate text-left">
                  {o.label}
                </BubbleLabel>
                {active && <Check className="h-4 w-4 shrink-0" aria-hidden />}
              </button>
            </BubbleRow>
          );
        })}
      </BubblePanel>
    </>
  );
}
