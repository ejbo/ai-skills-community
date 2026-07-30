// Locale-aware date-fns helpers. formatDistanceToNowStrict defaults to English,
// which leaks "3 days ago" into the 中文 UI (and 中文 into en/fr if hardcoded) —
// always route relative times through these with the next-intl locale.
import { formatDistanceToNowStrict, type FormatDistanceToNowStrictOptions } from 'date-fns';
import { zhCN, fr, enUS } from 'date-fns/locale';
import type { Locale as AppLocale } from '@/i18n/request';

const DATE_FNS_LOCALES = { 'zh-CN': zhCN, en: enUS, fr } as const;

export function dateFnsLocale(locale: string) {
  return DATE_FNS_LOCALES[locale as AppLocale] ?? zhCN;
}

/** "3 天前" / "3 days ago" / "il y a 3 jours" in the given UI locale. */
export function relativeTime(
  date: Date | string | number,
  locale: string,
  opts?: Omit<FormatDistanceToNowStrictOptions, 'locale'>,
) {
  return formatDistanceToNowStrict(new Date(date), {
    addSuffix: true,
    ...opts,
    locale: dateFnsLocale(locale),
  });
}
