'use client';

// 设置导航. Client-side only because the ACTIVE item needs the pathname: the
// settings layout is preserved across child navigations, so a server-read
// `x-pathname` would freeze on whichever page was opened first.
// lg+: a vertical list beside the page. Below lg: one horizontally scrolling
// row of pills (the page itself never scrolls sideways — only this strip does).

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, IdCard, Key, Languages, Lock, ShieldCheck, Tag, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type SettingsNavIcon = 'profile' | 'card' | 'tags' | 'notifications' | 'privacy' | 'tokens' | 'security' | 'language';

const ICONS: Record<SettingsNavIcon, LucideIcon> = {
  profile: User,
  card: IdCard,
  tags: Tag,
  notifications: Bell,
  privacy: ShieldCheck,
  tokens: Key,
  security: Lock,
  language: Languages,
};

export interface SettingsNavItem {
  href: string;
  label: string;
  icon: SettingsNavIcon;
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/settings') return pathname === '/settings';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SettingsNav({ items, ariaLabel }: { items: SettingsNavItem[]; ariaLabel: string }) {
  const pathname = usePathname() ?? '';
  return (
    <nav aria-label={ariaLabel} className="-mx-6 overflow-x-auto px-6 scroll-thin lg:mx-0 lg:overflow-visible lg:px-0">
      <ul className="flex w-max gap-1 pb-1 lg:w-auto lg:flex-col lg:gap-0.5 lg:pb-0">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = ICONS[item.icon];
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 dark:focus-visible:ring-zinc-100/30 ${
                  active
                    ? 'bg-zinc-900/[0.06] font-medium text-zinc-900 dark:bg-white/[0.08] dark:text-zinc-50'
                    : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100'
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${active ? '' : 'text-zinc-400 dark:text-zinc-500'}`} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
