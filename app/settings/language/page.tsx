import { getLocale, getTranslations } from 'next-intl/server';
import { LanguageForm } from './LanguageForm';

export const dynamic = 'force-dynamic';

export default async function LanguageSettingsPage() {
  const [locale, t] = await Promise.all([getLocale(), getTranslations('settings')]);
  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold">{t('language_title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('language_hint')}</p>
        <div className="mt-4">
          <LanguageForm current={locale} />
        </div>
      </section>
    </div>
  );
}
