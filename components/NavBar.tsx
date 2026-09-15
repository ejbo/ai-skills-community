import Link from 'next/link';
import type { Session } from 'next-auth';
import { getTranslations } from 'next-intl/server';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';
import { LoginLink } from './LoginLink';
import { SearchTrigger } from './SearchTrigger';
import { NavBarShell } from './NavBarShell';
import { NotificationBell } from './NotificationBell';
import { LanguageSwitcher } from './LanguageSwitcher';
import { NavMoreButton, NavOverflowProvider, NavPrimaryRow } from './nav-overflow';
import { withBasePath } from '@/lib/base-path';

export async function NavBar({ session }: { session: Session | null }) {
  const t = await getTranslations('nav');
  return (
    <NavBarShell>
      {/* The row is logo (fixed) | links (elastic) | actions (fixed). Only the
          middle is allowed to give, and it gives by MOVING links into the
          overflow menu rather than by clipping them — see nav-overflow.tsx. */}
      {/* PHONE BUDGET. The row must fit a 360 px screen, because when it does
          not, the overflowing action cluster widens the LAYOUT viewport (Chrome
          measured innerWidth 415 on a 390 px phone): every page then scrolls
          sideways, every `right: 0` drawer puts its ✕ off the glass and every
          popover clamped to innerWidth is cut off. At 360 px the `.container`
          gutters and the header's px-3 leave 288 px; below `sm` the row spends
          logo 90 + two gap-2 16 + search / 收纳 / bell 3 × 36 + avatar 60 + three
          gap-0.5 6 = 280 px signed in, and 90 + 16 + 2 × 36 + 「Se connecter」
          ~104 + 4 = 286 px signed out. 主题 (36) and 语言 (32) do not fit that budget, so
          below `sm` they are hidden here and rendered as rows of the 收纳 menu
          instead (NavMoreMenu.tsx, same breakpoint). Add an always-visible
          action and this arithmetic has to be redone. */}
      <header className="flex h-14 w-full items-center gap-2 rounded-2xl border border-zinc-200/70 bg-white/70 px-3 shadow-lg shadow-black/5 backdrop-blur-xl supports-[backdrop-filter]:bg-white/60 dark:border-zinc-800/70 dark:bg-zinc-950/70 dark:shadow-black/30 dark:supports-[backdrop-filter]:bg-zinc-950/60 sm:gap-3 sm:px-5 lg:gap-4">
        <NavOverflowProvider>
          <Link
            href="/"
            className="flex shrink-0 items-center gap-3 font-semibold tracking-tight sm:pr-1"
          >
            {/* withBasePath so it resolves under a subpath deploy (/ai-community/CARI_logo.webp) */}
            <img src={withBasePath('/CARI_logo.webp')} alt="CARI" className="h-8 w-auto" />
            {/* The wordmark is the first thing to go on a phone: the logo already
                identifies the site, and those ~100px are what let the action
                cluster stay whole. */}
            <span className="hidden whitespace-nowrap sm:inline">AI Community</span>
          </Link>

          <NavPrimaryRow />

          <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
            <SearchTrigger />
            {/* Below `sm` this lives in the 收纳 menu (see PHONE BUDGET above). */}
            <div className="hidden sm:flex">
              <ThemeToggle />
            </div>
            <NavMoreButton />
            {session?.user && <NotificationBell />}
            {/* Language sits immediately left of the avatar — 设置 → 语言 was too deep to find.
                Below `sm` it is a row of the 收纳 menu instead. */}
            <div className="hidden sm:flex">
              <LanguageSwitcher />
            </div>
            {session?.user ? (
              <UserMenu user={session.user} />
            ) : (
              <LoginLink className="whitespace-nowrap rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 sm:px-3.5">
                {t('login')}
              </LoginLink>
            )}
          </div>
        </NavOverflowProvider>
      </header>
    </NavBarShell>
  );
}
