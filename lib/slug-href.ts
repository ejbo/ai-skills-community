// Href builders for title-slug routes (docs/contracts/slugs.md). Pure and
// client-safe — cards, server pages, notifications and search all build links
// through these, never by hand, so every link a member copies carries the title.
//
// The segment is the row's slug when it has one, else its id (legacy rows until
// `pnpm slugs:backfill` runs — the route accepts both). It is percent-encoded:
// a CJK slug must survive `redirect()` (Location is a header) and stored
// notification links; the address bar still shows it decoded.

export interface Sluggable {
  id: string;
  slug?: string | null;
}

/** The URL segment for an item (or an already-chosen slug/id string). */
export function linkSegment(item: Sluggable | string): string {
  const key = typeof item === 'string' ? item : item.slug || item.id;
  return encodeURIComponent(key);
}

export function eventHref(event: Sluggable | string): string {
  return `/events/${linkSegment(event)}`;
}

export function topicHref(topic: Sluggable | string): string {
  return `/discussion/topics/${linkSegment(topic)}`;
}

export function feedbackHref(feedback: Sluggable | string): string {
  return `/feedback/${linkSegment(feedback)}`;
}

export function announcementHref(announcement: Sluggable | string): string {
  return `/announcements/${linkSegment(announcement)}`;
}

/** `/videos/<slug>` — videos have always been slug-routed; the slug is now a title slug. */
export function videoHref(slug: string): string {
  return `/videos/${encodeURIComponent(slug)}`;
}

/**
 * Should the page redirect to its canonical URL? Only when the row HAS a slug
 * and the param named it some other way (its id, or a retired slug). Call it
 * after the page's own access gate.
 */
export function needsCanonicalRedirect(resolved: { slug: string | null; canonical: boolean }): boolean {
  return !resolved.canonical && Boolean(resolved.slug);
}
