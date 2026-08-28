import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { UserTagsForm } from './UserTagsForm';
import { loginHref } from '@/lib/auth/callback-path';

export const dynamic = 'force-dynamic';

export default async function SettingsTagsPage() {
  const session = await auth();
  if (!session?.user) redirect(loginHref('/settings/tags'));
  const t = await getTranslations('settings');

  return (
    <section className="surface rounded-2xl p-6">
      <h2 className="text-lg font-semibold tracking-tight">{t('tags_title')}</h2>
      <p className="mt-1 text-sm text-muted">{t('tags_desc')}</p>
      <div className="mt-4">
        <UserTagsForm />
      </div>
    </section>
  );
}
