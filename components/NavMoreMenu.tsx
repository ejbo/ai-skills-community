'use client';

// Navbar overflow menu — the "收纳" button.
//
// The motion, the pill vocabulary and the portaled panel all live in
// components/BubbleMenuPanel.tsx, shared with the language and user menus so
// the three dropdowns on the bar cannot drift apart. See that file for why this
// is a framer-motion re-implementation of React Bits' <BubbleMenu /> rather
// than the GSAP component itself.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  BubbleLabel,
  BubblePanel,
  BubbleRow,
  BubbleToggleIcon,
  bubblePanelHeight,
  bubblePill,
  bubbleTriggerKeyDown,
} from '@/components/BubbleMenuPanel';
import { useAnchoredPanel } from '@/components/useAnchoredPanel';
import type { NavItem } from '@/components/nav-items';

const PANEL_W = 232;

export function NavMoreMenu({ items }: { items: NavItem[] }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const panel = useAnchoredPanel<HTMLButtonElement>({
    width: PANEL_W,
    height: bubblePanelHeight(items.length),
  });

  // Nothing to stash (should not happen — STASHED_NAV is never empty — but a
  // button that opens an empty sheet is worse than no button).
  if (items.length === 0) return null;

  const label = t('more');

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
      </BubblePanel>
    </>
  );
}
