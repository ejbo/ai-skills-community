// 最新评论与批注 — the pure bits of the activity rail (owner, 2026-10-09).
//
// Where an item LIVES is a URL the existing surfaces already honour:
//   comment → the doc page with `?focus=<commentId>` (DocComments scrolls + flashes it)
//   note    → the reader with `?ch=<chapter>&hl=<highlightId>` (ReaderShell flashes the
//             mark — own or, since 2026-10-09, a shared community note)
// The rail opens that URL in the side dock (a framed page), so the reader lands
// on the person's comment or on the highlighted passage with their note beside it.

import type { PublicAuthor } from '@/lib/user-identity';

export type ActivityKind = 'comment' | 'note';

export interface ActivityItem {
  kind: ActivityKind;
  id: string;
  /** ISO. */
  createdAt: string;
  author: PublicAuthor;
  /** Plain-text excerpt: a comment's markdown flattened, or the note itself. */
  text: string;
  /** Notes only — the highlighted passage. */
  quote: string | null;
  doc: { slug: string; title: string };
  href: string;
}

export function activityHref(a: { kind: ActivityKind; id: string; slug: string; chapterIndex?: number | null }): string {
  const base = `/library/${encodeURIComponent(a.slug)}`;
  if (a.kind === 'comment') return `${base}?focus=${encodeURIComponent(a.id)}`;
  return `${base}/read?ch=${Math.max(0, a.chapterIndex ?? 0)}&hl=${encodeURIComponent(a.id)}`;
}
