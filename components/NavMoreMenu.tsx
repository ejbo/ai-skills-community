'use client';

// Navbar overflow menu — the "收纳" button.
//
// The motion, the pill vocabulary and the portaled panel all live in
// components/BubbleMenuPanel.tsx, shared with the language and user menus so
// the three dropdowns on the bar cannot drift apart. See that file for why this
// is a framer-motion re-implementation of React Bits' <BubbleMenu /> rather
// than the GSAP component itself.
//
// PHONE ROWS. Below `sm` the navbar hides its 主题 and 语言 buttons (NavBar.tsx):
// logo + six actions did not fit a 390 px screen, and the overflowing cluster
// widened the LAYOUT viewport to 415 px — which pushed every `right: 0` drawer's
// ✕ and every edge-clamped popover past the glass on every page. Those two
// controls therefore move in here, under a hairline, for as long as the screen
// is that narrow. They are rendered (not CSS-hidden) only while it is: the panel
// moves focus to its items by role, and a `display: none` menuitem would be a
// dead stop for the arrow keys.

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Languages, Moon, Sun } from 'lucide-react';
import {
  BubbleLabel,
  BubblePanel,
  BubbleRow,
  BubbleToggleIcon,
  bubblePanelHeight,
  bubblePill,
  bubbleTriggerKeyDown,
} from '@/components/BubbleMenuPanel';
import { useLocaleSwitch } from '@/components/LanguageSwitcher';
import { useTheme } from '@/components/ThemeProvider';
import { useAnchoredPanel } from '@/components/useAnchoredPanel';
import type { NavItem } from '@/components/nav-items';
import { LOCALE_OPTIONS } from '@/lib/locales';

const PANEL_W = 232;

/**
 * Tailwind's `sm` is `min-width: 640px`; the phone rows exist exactly where the
 * navbar's `hidden sm:flex` wrappers hide the two buttons. Keep the two in step.
 */
export const NAV_PHONE_QUERY = '(max-width: 639.98px)';
/** The separator + 主题 row + 语言 row. */
const PHONE_ROWS = 2;
const SEPARATOR_H = 8;

function subscribePhone(onChange: () => void) {
  const mq = window.matchMedia(NAV_PHONE_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function useIsNavPhone(): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(NAV_PHONE_QUERY).matches,
    // The panel only ever renders on the client, after a click.
    () => false,
  );
}

export function NavMoreMenu({ items }: { items: NavItem[] }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const phone = useIsNavPhone();
  const { theme, toggle: toggleTheme } = useTheme();
  const { locale, choose: switchLocale } = useLocaleSwitch();
  const panel = useAnchoredPanel<HTMLButtonElement>({
    width: PANEL_W,
    height: bubblePanelHeight(items.length + (phone ? PHONE_ROWS : 0), phone ? SEPARATOR_H : 0),
  });

  // Nothing to stash (should not happen — STASHED_NAV is never empty — but a
  // button that opens an empty sheet is worse than no button).
  if (items.length === 0 && !phone) return null;

  const label = t('more');
  const dark = theme === 'dark';

  return (
    <>
      <button
        ref={panel.triggerRef}
        type="button"
        onClick={panel.toggle}
        onKeyDown={bubbleTriggerKeyDown(panel)}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={panel.open}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-600 transition hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:focus-visible:ring-zinc-100"
      >
        <BubbleToggleIcon open={panel.open} />
      </button>

      <BubblePanel panel={panel} label={label} width={PANEL_W}>
        {items.map((item, i) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <BubbleRow key={item.href} index={i}>
              <Link
                role="menuitem"
                href={item.href}
                onClick={() => panel.close()}
                aria-current={active ? 'page' : undefined}
                className={bubblePill(active)}
              >
                <item.Icon className="h-4 w-4 shrink-0" aria-hidden />
                <BubbleLabel index={i} className="truncate">
                  {t(item.key)}
                </BubbleLabel>
              </Link>
            </BubbleRow>
          );
        })}
        {phone && (
          <>
            {items.length > 0 && (
              <li role="separator" className="mx-2 my-0.5 h-px bg-zinc-200 dark:bg-zinc-800" />
            )}
            <BubbleRow index={items.length}>
              {/* Stays open: the page re-themes behind the menu, which is the feedback. */}
              <button
                type="button"
                role="menuitem"
                data-bubble-aux=""
                onClick={toggleTheme}
                className={bubblePill(false)}
              >
                {dark ? <Sun className="h-4 w-4 shrink-0" aria-hidden /> : <Moon className="h-4 w-4 shrink-0" aria-hidden />}
                <BubbleLabel index={items.length} className="truncate">
                  {dark ? t('theme_light') : t('theme_dark')}
                </BubbleLabel>
              </button>
            </BubbleRow>
            <BubbleRow index={items.length + 1}>
              <div role="group" aria-label={t('language')} className="flex items-center gap-1.5">
                <Languages className="mx-2 h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" aria-hidden />
                {LOCALE_OPTIONS.map((o) => {
                  const active = o.code === locale;
                  return (
                    <button
                      key={o.code}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      // The short badge is what fits three across; the name is
                      // announced in its own tongue, like the desktop switcher.
                      aria-label={o.label}
                      data-bubble-aux=""
                      onClick={() => {
                        panel.close();
                        switchLocale(o.code);
                      }}
                      className={`${bubblePill(active)} min-w-0 flex-1 justify-center`}
                    >
                      {o.short}
                    </button>
                  );
                })}
              </div>
            </BubbleRow>
          </>
        )}
      </BubblePanel>
    </>
  );
}
