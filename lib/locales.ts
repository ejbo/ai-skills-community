// Single source of truth for the UI languages. Deliberately import-free so BOTH
// the server config (i18n/request.ts) and client components can use it.
//
// Language names are ALWAYS shown in their own tongue (standard practice — a user
// stuck in the wrong language must still be able to find theirs). `short` is the
// 1–2 char badge the navbar switcher shows for the ACTIVE locale.
export const LOCALE_OPTIONS = [
  { code: 'zh-CN', label: '中文', short: '中' },
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'fr', label: 'Français', short: 'FR' },
] as const;

export type Locale = (typeof LOCALE_OPTIONS)[number]['code'];

export const SUPPORTED_LOCALES: readonly Locale[] = LOCALE_OPTIONS.map((o) => o.code);

const YEAR_S = 365 * 24 * 60 * 60;

/**
 * Persist the viewer's explicit choice. `i18n/request.ts` reads this cookie
 * server-side and it wins over Accept-Language; `path=/` also covers the
 * `/ai-community` subpath deploy. Client-only — call it from an event handler,
 * then `router.refresh()` to re-render the tree in the new locale.
 */
export function setLocaleCookie(code: string) {
  document.cookie = `locale=${code};path=/;max-age=${YEAR_S};samesite=lax`;
}
