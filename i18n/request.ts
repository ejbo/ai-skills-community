import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';

const SUPPORTED_LOCALES = ['zh-CN', 'en'] as const;
type Locale = (typeof SUPPORTED_LOCALES)[number];

function pickLocale(): Locale {
  const cookieLocale = cookies().get('locale')?.value;
  if (cookieLocale && SUPPORTED_LOCALES.includes(cookieLocale as Locale)) {
    return cookieLocale as Locale;
  }
  const host = headers().get('host') ?? '';
  if (host.includes('huawei')) return 'zh-CN';
  const accept = headers().get('accept-language') ?? '';
  if (accept.toLowerCase().startsWith('zh')) return 'zh-CN';
  return 'en';
}

export default getRequestConfig(async () => {
  const locale = pickLocale();
  const messages = (await import(`../messages/${locale}.json`)).default;
  return { locale, messages };
});
