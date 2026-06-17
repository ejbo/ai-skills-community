import Link from 'next/link';
import type { Session } from 'next-auth';
import { Sparkles } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';
import { SearchTrigger } from './SearchTrigger';
import { NavLink } from './NavLink';
import { getTranslations } from 'next-intl/server';

export async function NavBar({ session }: { session: Session | null }) {
  const t = await getTranslations('nav');
  return (
    <div className="sticky top-0 z-40 px-3 pt-3 sm:px-4">
      <header className="mx-auto flex h-14 max-w-6xl items-center gap-6 rounded-2xl border border-zinc-200/70 bg-white/70 px-4 shadow-lg shadow-black/5 backdrop-blur-xl supports-[backdrop-filter]:bg-white/60 dark:border-zinc-800/70 dark:bg-zinc-950/70 dark:shadow-black/30 dark:supports-[backdrop-filter]:bg-zinc-950/60 sm:px-5">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <Sparkles className="h-5 w-5 text-accent-500" />
          <span>AI Community</span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          <NavLink href="/skills">{t('browse')}</NavLink>
          <NavLink href="/videos">{t('videos')}</NavLink>
          <NavLink href="/docs/cli">{t('docs')}</NavLink>
        </nav>
        <div className="flex flex-1 items-center justify-end gap-2">
          <SearchTrigger />
          <ThemeToggle />
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
    </div>
  );
}
