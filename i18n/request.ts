import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';

export const SUPPORTED_LOCALES = ['zh-CN', 'en', 'fr'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

function pickLocale(): Locale {
  // The cookie is the user's explicit choice (set in 设置 → 语言) and wins;
  // Accept-Language is only the first-visit default.
  const cookieLocale = cookies().get('locale')?.value;
  if (cookieLocale && SUPPORTED_LOCALES.includes(cookieLocale as Locale)) {
    return cookieLocale as Locale;
  }
  const accept = (headers().get('accept-language') ?? '').toLowerCase();
  if (accept.startsWith('en')) return 'en';
  if (accept.startsWith('fr')) return 'fr';
  return 'zh-CN';
}

export default getRequestConfig(async () => {
  const locale = pickLocale();
  const messages = (await import(`../messages/${locale}.json`)).default;
  return { locale, messages };
});
