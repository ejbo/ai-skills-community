import { getLocale, getTranslations } from 'next-intl/server';
import { LanguageForm } from './LanguageForm';
import { AutoTranslateForm } from './AutoTranslateForm';

export const dynamic = 'force-dynamic';

export default async function LanguageSettingsPage() {
  const [locale, t, tt, tl] = await Promise.all([
    getLocale(),
    getTranslations('settings'),
    getTranslations('translate'),
    getTranslations('labels'),
  ]);
  const langKey = locale.toLowerCase().startsWith('zh') ? 'zh' : locale.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold">{t('language_title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('language_hint')}</p>
        <div className="mt-4">
          <LanguageForm current={locale} />
        </div>
      </section>

      {/* 内容翻译 — what to do with posts / comments written in ANOTHER language than the one chosen above. */}
      <section>
        <h2 className="text-lg font-semibold">{tt('settings_title')}</h2>
        <p className="mt-1 text-sm text-muted">{tt('settings_desc', { lang: tl(`lang.${langKey}`) })}</p>
        <div className="mt-4">
          <AutoTranslateForm />
        </div>
      </section>
    </div>
  );
}
