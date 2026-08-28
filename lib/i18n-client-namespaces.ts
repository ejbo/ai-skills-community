/**
 * The top-level message namespaces that are allowed to cross into the CLIENT
 * bundle (`<NextIntlClientProvider messages>` in app/layout.tsx).
 *
 * WHY this list exists: the full catalog is 238–289 KB of JSON and the root
 * layout is `no-store`, so handing `getMessages()` straight to the provider
 * re-serialized and re-gzipped the WHOLE catalog into every single HTML
 * document — measured at 80.8% of a 281 KB document. Narrowing it to what
 * client components actually read raised document throughput by ~51% on a
 * production build. SERVER components are unaffected: `getTranslations()` /
 * `getMessages()` still read the full catalog, so `docs_page` (44 KB on its
 * own), `api_errors`, `dashboard`, `admin`, `shelf`, `announcements` and
 * `discussion_pages` keep working — they are simply never shipped.
 *
 * THE RULE for editing it: a namespace belongs here if ANY module that ends up
 * in the client bundle (a `'use client'` file, or a module one of them imports)
 * calls `useTranslations('<ns>')` — including nested forms like
 * `useTranslations('detail.chat')`, which need their TOP-level key `detail` —
 * or reaches the key through a bare `useTranslations()` (`g('common.delete')`).
 * When in doubt, INCLUDE it: a missing namespace renders the raw key path
 * ("feedback.title") to users, which is far worse than a few KB.
 *
 * HOW to regenerate: don't do it by hand — `tests/i18n-client-namespaces.test.ts`
 * walks the repo, builds the client module graph and reports, in both
 * directions, every namespace that is missing from or stale in this list. Run
 * `pnpm test i18n-client-namespaces` and paste what it names.
 */
export const CLIENT_MESSAGE_NAMESPACES = [
  'auth',
  'auth_error',
  'browse',
  'common',
  'detail',
  'discussion',
  'discussion_ui',
  'event_form',
  'events',
  'feedback',
  'github_trending',
  'home',
  'labels',
  'library',
  'library_cards',
  'library_ui',
  'nav',
  'notifications',
  'polls',
  'profile',
  'reader',
  'settings',
  'shorts',
  'skill_compare',
  'skill_detail',
  'skill_manage',
  'skills_misc',
  'source',
  'stickers',
  'ui',
  'upload',
  'video',
  'video_ui',
  'votes',
  'zones',
] as const;

export type ClientMessageNamespace = (typeof CLIENT_MESSAGE_NAMESPACES)[number];

/**
 * Narrow a full message catalog to {@link CLIENT_MESSAGE_NAMESPACES}.
 *
 * next-intl 3.26 ships no `pick` helper (and lodash is not a dependency), so
 * this is the three-line version. It returns the SAME shape it was given — a
 * missing namespace is skipped rather than written as `undefined`, because
 * next-intl treats an explicit `undefined` branch as a broken message tree.
 */
export function pickClientMessages<T extends Record<string, unknown>>(messages: T): T {
  const out: Record<string, unknown> = {};
  for (const ns of CLIENT_MESSAGE_NAMESPACES) if (ns in messages) out[ns] = messages[ns];
  return out as T;
}
