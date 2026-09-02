// What each navbar section shows when you hover it.
//
// A plain module (no 'use client', no next-intl) for the same reason
// nav-items.ts is one: the catalog is data, the renderer translates.
//
// Labels are `<namespace>:<key>` and every namespace here is on the
// CLIENT_MESSAGE_NAMESPACES allowlist (lib/i18n-client-namespaces.ts) — a
// namespace that is not shipped to the browser renders as a raw key path.
// Taxonomy labels come from the board that OWNS the taxonomy (`labels.*`), the
// same rule the homepage chips follow.
//
// Every href below was checked against the page that reads it. Three traps are
// load-bearing:
//   • Bare `/videos` IS the Geek Videos tab — it must carry NO `tab` param.
//   • `/videos?tab=shorts` is IGNORED when `q`/`category`/`sort`/`page` is also
//     present (the page's `isBrowse` check short-circuits first), so a shorts
//     link may never carry one.
//   • `/zones` facets are SINGULAR and comma-joined (`?lab=A,B`), never
//     repeated keys — `firstParam` drops everything after the first.

export interface MegaLink {
  href: string;
  /** `<namespace>:<key>` into the message catalog. */
  t: string;
}

export interface MegaColumn {
  /** Column heading, `<namespace>:<key>`. Omit for an unlabelled column. */
  t?: string;
  links: MegaLink[];
}

export type MegaMenu =
  | { kind: 'links'; columns: MegaColumn[] }
  /** 技术专区: the 研究所 image grid, fetched on first hover. */
  | { kind: 'labs'; columns: MegaColumn[] };

/** Keyed by the PRIMARY_NAV href. A section with no entry has no hover panel. */
export const NAV_MEGA: Record<string, MegaMenu> = {
  '/skills': {
    kind: 'links',
    columns: [
      {
        t: 'nav:mega_browse',
        links: [
          { href: '/skills', t: 'browse:all' },
          { href: '/skills?source=external', t: 'browse:external' },
          { href: '/skills?source=curated', t: 'browse:curated' },
          { href: '/skills?source=internal', t: 'browse:internal' },
        ],
      },
      {
        t: 'nav:mega_more',
        links: [
          // The only packs browse entry — there is no /packs index route.
          { href: '/skills?source=packs', t: 'browse:packs' },
          { href: '/categories', t: 'nav:categories' },
          { href: '/skills?sort=newest', t: 'browse:sort_newest' },
          { href: '/skills?sort=top_rated', t: 'browse:sort_top_rated' },
        ],
      },
    ],
  },

  '/videos': {
    kind: 'links',
    columns: [
      {
        t: 'nav:mega_browse',
        links: [
          { href: '/videos', t: 'shorts:tab_videos' },
          { href: '/videos?tab=shorts', t: 'shorts:tab_shorts' },
        ],
      },
      {
        t: 'nav:mega_shorts',
        links: [
          { href: '/videos/shorts', t: 'nav:mega_shorts_feed' },
          { href: '/videos/shorts?sort=new', t: 'shorts:sort_new' },
          { href: '/videos/shorts?upload=1', t: 'shorts:upload' },
        ],
      },
    ],
  },

  '/library': {
    kind: 'links',
    columns: [
      {
        t: 'nav:mega_type',
        links: [
          { href: '/library?type=book', t: 'labels:docType.book' },
          { href: '/library?type=paper', t: 'labels:docType.paper' },
          { href: '/library?type=blog', t: 'labels:docType.blog' },
          { href: '/library?type=report', t: 'labels:docType.report' },
        ],
      },
      {
        t: 'nav:mega_more',
        links: [
          { href: '/library', t: 'browse:sort_newest' },
          { href: '/library?sort=featured', t: 'library_cards:sort_featured' },
          { href: '/library?sort=shelved', t: 'library_cards:sort_shelved' },
          { href: '/library/shelf', t: 'nav:shelf' },
        ],
      },
    ],
  },

  '/discussion': {
    kind: 'links',
    columns: [
      {
        t: 'nav:mega_browse',
        links: [
          { href: '/discussion', t: 'discussion:tab_posts' },
          { href: '/discussion?sort=hot', t: 'nav:mega_hot_posts' },
          { href: '/discussion?tab=forum', t: 'discussion:tab_forum' },
          { href: '/discussion?tab=forum&sort=top', t: 'nav:mega_hot_topics' },
        ],
      },
      {
        t: 'nav:mega_topics',
        links: [
          { href: '/discussion?tab=forum&category=tech', t: 'labels:discussionCategory.tech' },
          { href: '/discussion?tab=forum&category=models', t: 'labels:discussionCategory.models' },
          { href: '/discussion?tab=forum&category=agents', t: 'labels:discussionCategory.agents' },
          { href: '/discussion?tab=forum&category=skills', t: 'labels:discussionCategory.skills' },
        ],
      },
      {
        links: [
          { href: '/discussion?tab=forum&category=research', t: 'labels:discussionCategory.research' },
          { href: '/discussion?tab=forum&category=qa', t: 'labels:discussionCategory.qa' },
          { href: '/discussion?tab=forum&category=share', t: 'labels:discussionCategory.share' },
          { href: '/discussion?tab=forum&category=showcase', t: 'labels:discussionCategory.showcase' },
        ],
      },
    ],
  },

  '/zones': {
    kind: 'labs',
    columns: [
      {
        links: [
          { href: '/zones', t: 'nav:mega_zone_feed' },
          { href: '/zones?tab=boards', t: 'nav:mega_zone_boards' },
          { href: '/zones?tab=mine', t: 'nav:mega_zone_mine' },
        ],
      },
    ],
  },

  '/events': {
    kind: 'links',
    columns: [
      {
        t: 'nav:mega_browse',
        links: [
          { href: '/events', t: 'events:tab_upcoming' },
          { href: '/events?tab=past', t: 'events:tab_past' },
          { href: '/events?mine=1', t: 'nav:mega_event_mine' },
        ],
      },
      {
        t: 'nav:mega_kind',
        links: [
          { href: '/events?kind=expert_talk', t: 'labels:eventKind.expert_talk' },
          { href: '/events?kind=seminar', t: 'labels:eventKind.seminar' },
          { href: '/events?kind=internal', t: 'labels:eventKind.internal' },
          { href: '/events?kind=external', t: 'labels:eventKind.external' },
        ],
      },
    ],
  },
};

/** `/zones?tab=boards&lab=<name>` — comma-joined param, encoded once. */
export function labHref(lab: string): string {
  const p = new URLSearchParams({ tab: 'boards', lab });
  return `/zones?${p.toString()}`;
}
