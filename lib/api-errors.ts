import { getTranslations } from 'next-intl/server';

/**
 * Localized `reason` text for API error payloads.
 *
 * Clients render `data.reason ?? t('…')`, so a hardcoded Chinese `reason` wins
 * over the caller's translated fallback and an en/fr user gets a Chinese toast.
 * Route handlers CAN resolve the locale (i18n/request.ts reads the `locale`
 * cookie, which same-origin client `fetch` sends automatically), so build the
 * reason here instead. The machine-readable `error` code stays untranslated.
 */
export async function apiReason(
  key: string,
  values?: Record<string, string | number | Date>,
): Promise<string> {
  const t = await getTranslations('api_errors');
  return t(key, values);
}
