import Link from 'next/link';
import type { Session } from 'next-auth';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';
import { SearchTrigger } from './SearchTrigger';
import { NavBarShell } from './NavBarShell';
import { NotificationBell } from './NotificationBell';
import { LanguageSwitcher } from './LanguageSwitcher';
import { NavMoreButton, NavOverflowProvider, NavPrimaryRow } from './nav-overflow';
import { getTranslations } from 'next-intl/server';
import { withBasePath } from '@/lib/base-path';

export async function NavBar({ session }: { session: Session | null }) {
  const t = await getTranslations('nav');
  return (
    <NavBarShell>
      {/* The row is logo (fixed) | links (elastic) | actions (fixed). Only the
          middle is allowed to give, and it gives by MOVING links into the
          overflow menu rather than by clipping them — see nav-overflow.tsx. */}
      <header className="flex h-14 w-full items-center gap-3 rounded-2xl border border-zinc-200/70 bg-white/70 px-4 shadow-lg shadow-black/5 backdrop-blur-xl supports-[backdrop-filter]:bg-white/60 dark:border-zinc-800/70 dark:bg-zinc-950/70 dark:shadow-black/30 dark:supports-[backdrop-filter]:bg-zinc-950/60 sm:px-5 lg:gap-4">
        <NavOverflowProvider>
          <Link
            href="/"
            className="flex shrink-0 items-center gap-3 pr-1 font-semibold tracking-tight"
          >
            {/* withBasePath so it resolves under a subpath deploy (/ai-community/CARI_logo.webp) */}
            <img src={withBasePath('/CARI_logo.webp')} alt="CARI" className="h-8 w-auto" />
            {/* The wordmark is the first thing to go on a phone: the logo already
                identifies the site, and those ~100px are what let the action
                cluster stay whole. */}
            <span className="hidden whitespace-nowrap sm:inline">AI Community</span>
          </Link>

          <NavPrimaryRow />

          <div className="flex shrink-0 items-center gap-1">
            <SearchTrigger />
            <ThemeToggle />
            <NavMoreButton />
            {session?.user && <NotificationBell />}
            {/* Language sits immediately left of the avatar — 设置 → 语言 was too deep to find. */}
            <LanguageSwitcher />
            {session?.user ? (
              <UserMenu user={session.user} />
            ) : (
              <Link
                href="/auth/login"
                className="whitespace-nowrap rounded-lg bg-zinc-900 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                {t('login')}
              </Link>
            )}
          </div>
        </NavOverflowProvider>
      </header>
    </NavBarShell>
  );
}
