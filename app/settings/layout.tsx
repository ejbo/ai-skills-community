import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { loginHref } from '@/lib/auth/callback-path';
import { SettingsNav, type SettingsNavItem } from './_components/SettingsNav';

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect(loginHref('/settings'));
  const t = await getTranslations('settings');

  const links: SettingsNavItem[] = [
    { href: '/settings', label: t('nav_profile'), icon: 'profile' },
    { href: '/settings/card', label: t('nav_card'), icon: 'card' },
    { href: '/settings/tags', label: t('nav_tags'), icon: 'tags' },
    { href: '/settings/notifications', label: t('nav_notifications'), icon: 'notifications' },
    { href: '/settings/privacy', label: t('nav_privacy'), icon: 'privacy' },
    { href: '/settings/tokens', label: t('nav_tokens'), icon: 'tokens' },
    { href: '/settings/security', label: t('nav_security'), icon: 'security' },
    { href: '/settings/language', label: t('nav_language'), icon: 'language' },
  ];

  return (
    <div className="container py-8">
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">{t('title')}</h1>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8">
        <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <SettingsNav items={links} ariaLabel={t('title')} />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
