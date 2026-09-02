'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ChevronDown,
  LayoutDashboard,
  LibraryBig,
  LogOut,
  Settings,
  ShieldCheck,
  User,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import {
  BubbleLabel,
  BubblePanel,
  BubbleRow,
  bubblePanelHeight,
  bubblePill,
  bubbleTriggerKeyDown,
} from '@/components/BubbleMenuPanel';
import { useAnchoredPanel } from '@/components/useAnchoredPanel';
import { withBasePath } from '@/lib/base-path';
import { Avatar } from '@/components/Avatar';

// Avatar dropdown. Navigation to the viewer's OWN surfaces (主页 / 面板 / 书架 /
// 设置) plus sign-out — never an authoring action, which is why 上传 Skill lives
// on /skills and not here.
//
// Shares the bubble-menu motion and the portaled panel with 收纳 and the
// language menu (components/BubbleMenuPanel.tsx).

interface MenuUser {
  id: string;
  email: string;
  displayName?: string;
  handle?: string;
  /** Staff flag (any permission at all) — gates the 管理后台 entry link only, never a domain decision. */
  isAdmin?: boolean;
  avatarUrl?: string | null;
  image?: string | null;
}

const PANEL_W = 248;
/** The email caption above the pills. */
const HEADER_H = 26;

export function UserMenu({ user }: { user: MenuUser }) {
  const t = useTranslations('nav');
  const pathname = usePathname();

  const links: { href: string; Icon: LucideIcon; label: string }[] = [
    { href: `/users/${user.handle ?? user.id}`, Icon: User, label: t('profile') },
    { href: '/dashboard', Icon: LayoutDashboard, label: t('dashboard') },
    { href: '/library/shelf', Icon: LibraryBig, label: t('shelf') },
    { href: '/settings', Icon: Settings, label: t('settings') },
    // The operator seeing their own tools — not a role badge shown to others.
    ...(user.isAdmin
      ? [{ href: '/manage', Icon: ShieldCheck, label: t('manage') }]
      : []),
  ];

  const panel = useAnchoredPanel<HTMLButtonElement>({
    width: PANEL_W,
    // +1 for the sign-out pill, which is not a link.
    height: bubblePanelHeight(links.length + 1, HEADER_H),
  });

  const name = user.displayName ?? user.email;

  return (
    <>
      <button
        ref={panel.triggerRef}
        type="button"
        onClick={panel.toggle}
        onKeyDown={bubbleTriggerKeyDown(panel)}
        aria-label={name}
        aria-haspopup="menu"
        aria-expanded={panel.open}
        className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 transition hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:hover:bg-zinc-800 dark:focus-visible:ring-zinc-100"
      >
        <Avatar name={name} src={user.avatarUrl ?? user.image ?? null} size="sm" />
        <ChevronDown
          className={`h-3.5 w-3.5 text-zinc-500 transition-transform duration-300 ${
            panel.open ? 'rotate-180' : ''
          }`}
        />
      </button>

      <BubblePanel
        panel={panel}
        label={name}
        width={PANEL_W}
        header={<div className="truncate px-3 pb-1.5 pt-1 text-[11px] text-muted">{user.email}</div>}
      >
        {links.map((item, i) => {
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
                  {item.label}
                </BubbleLabel>
              </Link>
            </BubbleRow>
          );
        })}
        <BubbleRow index={links.length}>
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              panel.close();
              // Clear the session, then navigate client-side. Letting next-auth build the
              // post-logout redirect server-side resolved the host wrong behind the proxy
              // (→ localhost:3100); navigating in the browser keeps us on the real origin.
              await signOut({ redirect: false });
              window.location.href = withBasePath('/');
            }}
            className={bubblePill()}
          >
            <LogOut className="h-4 w-4 shrink-0" aria-hidden />
            <BubbleLabel index={links.length} className="truncate">
              {t('logout')}
            </BubbleLabel>
          </button>
        </BubbleRow>
      </BubblePanel>
    </>
  );
}
