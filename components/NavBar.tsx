import Link from 'next/link';
import type { Session } from 'next-auth';
import { MessageSquarePlus } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';
import { SearchTrigger } from './SearchTrigger';
import { NavLink } from './NavLink';
import { NavBarShell } from './NavBarShell';
import { NotificationBell } from './NotificationBell';
import { LanguageSwitcher } from './LanguageSwitcher';
import { getTranslations } from 'next-intl/server';
import { withBasePath } from '@/lib/base-path';

export async function NavBar({ session }: { session: Session | null }) {
  const t = await getTranslations('nav');
  return (
    <NavBarShell>
      {/* Gaps/padding are deliberately tight: at 14" (≈1440–1512 logical) the
          logo + 6 nav links + action cluster have to fit one 56px row. */}
      <header className="flex h-14 w-full items-center gap-3 rounded-2xl border border-zinc-200/70 bg-white/70 px-4 shadow-lg shadow-black/5 backdrop-blur-xl supports-[backdrop-filter]:bg-white/60 dark:border-zinc-800/70 dark:bg-zinc-950/70 dark:shadow-black/30 dark:supports-[backdrop-filter]:bg-zinc-950/60 sm:px-5 lg:gap-5">
        <Link href="/" className="flex shrink-0 items-center gap-3 pr-1 font-semibold tracking-tight">
          {/* withBasePath so it resolves under a subpath deploy (/ai-community/CARI_logo.webp) */}
          <img src={withBasePath('/CARI_logo.webp')} alt="CARI" className="h-8 w-auto" />
          <span className="whitespace-nowrap">AI Community</span>
        </Link>
        <nav className="hidden min-w-0 items-center gap-0.5 md:flex lg:gap-1">
          <NavLink href="/skills">{t('browse')}</NavLink>
          <NavLink href="/videos">{t('videos')}</NavLink>
          <NavLink href="/library">{t('library')}</NavLink>
          <NavLink href="/discussion">{t('discussion')}</NavLink>
          <NavLink href="/events">{t('events')}</NavLink>
          <NavLink href="/votes">{t('votes')}</NavLink>
          <NavLink href="/docs">{t('docs')}</NavLink>
        </nav>
        <div className="flex flex-1 items-center justify-end gap-1">
          <SearchTrigger />
          <ThemeToggle />
          <Link
            href="/feedback"
            aria-label={t('feedback')}
            title={t('feedback')}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <MessageSquarePlus className="h-4 w-4" />
          </Link>
          {session?.user && <NotificationBell />}
          {/* Language sits immediately left of the avatar — 设置 → 语言 was too deep to find. */}
          <LanguageSwitcher />
          {session?.user ? (
            <UserMenu user={session.user} />
          ) : (
            <Link
              href="/auth/login"
              className="rounded-lg bg-accent-500 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-accent-600"
            >
              {t('login')}
            </Link>
          )}
        </div>
      </header>
    </NavBarShell>
  );
}
