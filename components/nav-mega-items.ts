// What each navbar section shows when you hover it.
//
// A plain module (no 'use client', no next-intl) for the same reason
// nav-items.ts is one: the catalog is data, the renderer translates.
//
// ── WHAT BELONGS IN A PANEL (owner decision, 2026-09-02) ─────────────────────
// A hover panel is for a section that is really SEVERAL surfaces wearing one
// nav link. It is NOT a place to re-list a section's filters: the first cut of
// this file mirrored every taxonomy (skill sources, doc types, forum
// categories, event kinds) and the owner rejected it as 「太冗余」— those chips
// are already on the page the link goes to, one click away, where they carry
// their counts and their state.
//
// So only three sections have panels, and each panel lists that section's own
// real halves — nothing else:
//   • /videos     — Geek Videos and Shorts (two boards, one nav link).
//   • /discussion — 动态 (feed) and 讨论帖 (forum), the page's own two tabs.
//   • /zones      — the 研究所 grid, which is a picture-led INDEX that exists
//                   nowhere else in the chrome (edit lib/zones/labs.ts).
// /skills, /library and /events have NO entry here on purpose, and a section
// with no entry must behave as a plain link: `useNavMega` bails on an href it
// cannot find, so hovering opens nothing. Adding a key back is a product
// decision, not a tidiness one.
//
// Labels are `<namespace>:<key>` and every namespace here is on the
// CLIENT_MESSAGE_NAMESPACES allowlist (lib/i18n-client-namespaces.ts) — a
// namespace that is not shipped to the browser renders as a raw key path.
// Panel labels reuse the DESTINATION page's own tab strings, so the panel and
// the page can never drift apart in any of the three locales.
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
  // The section is named after the long-form board, so bare `/videos` is Geek
  // Videos. Shorts is the other half of the same nav link and has no other
  // entry point in the chrome — listing only the half the owner named would
  // bury a whole surface.
  '/videos': {
    kind: 'links',
    columns: [
      {
        links: [
          { href: '/videos', t: 'shorts:tab_videos' },
          { href: '/videos?tab=shorts', t: 'shorts:tab_shorts' },
        ],
      },
    ],
  },

  // Exactly the two tabs `DiscussionTabs` renders, and the same two strings.
  // 动态 is the DEFAULT tab, so its href carries no `tab` param — `?tab=posts`
  // would work by accident (the page tests for `=== 'forum'`) but would make
  // the nav link and the tab strip disagree about the canonical URL.
  '/discussion': {
    kind: 'links',
    columns: [
      {
        links: [
          { href: '/discussion', t: 'discussion:tab_posts' },
          { href: '/discussion?tab=forum', t: 'discussion:tab_forum' },
        ],
      },
    ],
  },

  // The 研究所 tiles come from lib/zones/labs.ts (curated order + artwork,
  // live counts). The three links beside them are the hub's own tabs, the same
  // "this section's real halves" rule the two panels above follow.
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
};

/** `/zones?tab=boards&lab=<name>` — comma-joined param, encoded once. */
export function labHref(lab: string): string {
  const p = new URLSearchParams({ tab: 'boards', lab });
  return `/zones?${p.toString()}`;
}
