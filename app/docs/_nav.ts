// Single source of truth for the docs tree — the sidebar (layout.tsx) and the
// /docs index render from this same list, so they can't drift apart. Labels are
// i18n KEYS in the `docs_page` namespace, resolved by each consumer.

export interface DocItem {
  href: string;
  /** `docs_page` key for the sidebar/card title. */
  labelKey: string;
  /** `docs_page` key for the one-line description shown on the index. */
  descKey: string;
}

export interface DocGroup {
  /** `docs_page` key for the group heading. */
  labelKey: string;
  items: DocItem[];
}

export const DOC_GROUPS: DocGroup[] = [
  {
    labelKey: 'group_start',
    items: [
      { href: '/docs', labelKey: 'nav_overview', descKey: 'desc_overview' },
      { href: '/docs/start', labelKey: 'nav_start', descKey: 'desc_start' },
    ],
  },
  {
    labelKey: 'group_skills',
    items: [
      { href: '/docs/cli', labelKey: 'nav_cli', descKey: 'desc_cli' },
      { href: '/docs/authoring', labelKey: 'nav_authoring', descKey: 'desc_authoring' },
      { href: '/docs/publish', labelKey: 'nav_publish', descKey: 'desc_publish' },
    ],
  },
  {
    labelKey: 'group_community',
    items: [
      { href: '/docs/discussion', labelKey: 'nav_discussion', descKey: 'desc_discussion' },
      { href: '/docs/library', labelKey: 'nav_library', descKey: 'desc_library' },
      { href: '/docs/events', labelKey: 'nav_events', descKey: 'desc_events' },
    ],
  },
  {
    labelKey: 'group_policy',
    items: [
      { href: '/docs/account', labelKey: 'nav_account', descKey: 'desc_account' },
      { href: '/docs/conduct', labelKey: 'nav_conduct', descKey: 'desc_conduct' },
      { href: '/docs/content', labelKey: 'nav_content', descKey: 'desc_content' },
    ],
  },
];
