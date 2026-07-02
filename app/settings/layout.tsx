import Link from 'next/link';
import { redirect } from 'next/navigation';
import { User, Key, Lock, Bell, Languages } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/auth/login?callbackUrl=/settings');
  const t = await getTranslations('settings');

  const links = [
    { href: '/settings', label: t('nav_profile'), icon: <User className="h-4 w-4" /> },
    { href: '/settings/notifications', label: t('nav_notifications'), icon: <Bell className="h-4 w-4" /> },
    { href: '/settings/tokens', label: t('nav_tokens'), icon: <Key className="h-4 w-4" /> },
    { href: '/settings/security', label: t('nav_security'), icon: <Lock className="h-4 w-4" /> },
    { href: '/settings/language', label: t('nav_language'), icon: <Languages className="h-4 w-4" /> },
  ];

  return (
    <div className="container py-8">
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">{t('title')}</h1>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[200px_1fr]">
        <aside>
          <nav className="flex flex-col gap-0.5">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
              >
                {l.icon}
                {l.label}
              </Link>
            ))}
          </nav>
        </aside>
        <div>{children}</div>
      </div>
    </div>
  );
}
