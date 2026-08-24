// Public author identity + 隐私账号 trimming.
//
// Query layers select AUTHOR_IDENTITY_SELECT (the classic { handle, displayName,
// avatarUrl } trio plus department / lab / isPrivate). Every server boundary
// (RSC page or API route) MUST map rows through toPublicAuthor() before author
// data reaches a client component: for a private account department/lab are
// stripped server-side (never shipped-then-hidden client-side), unless the
// viewer holds the `identity` permission (`can(session.user, 'identity')`). `handle` is always kept — it is the profile-URL and
// ownership key — but UI must not render the `@handle` text when `isPrivate`
// (for SSO users the handle is the W3 工号).

export const AUTHOR_IDENTITY_FIELDS = {
  handle: true,
  displayName: true,
  avatarUrl: true,
  department: true,
  lab: true,
  isPrivate: true,
} as const;

/** Drop-in replacement for the `{ select: { handle, displayName, avatarUrl } }` author selects. */
export const AUTHOR_IDENTITY_SELECT = { select: AUTHOR_IDENTITY_FIELDS } as const;

export interface AuthorIdentity {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  department: string | null;
  lab: string | null;
  isPrivate: boolean;
}

/** What actually ships to clients. Same shape; department/lab already trimmed. */
export interface PublicAuthor {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  department: string | null;
  lab: string | null;
  isPrivate: boolean;
}

/**
 * Trim an author for public consumption. Returns a NEW object with exactly the
 * PublicAuthor fields — extra selected fields (id, email, …) never pass through.
 */
export function toPublicAuthor(author: AuthorIdentity, viewerCanSeeIdentity = false): PublicAuthor {
  const hide = author.isPrivate && !viewerCanSeeIdentity;
  return {
    handle: author.handle,
    displayName: author.displayName,
    avatarUrl: author.avatarUrl ?? null,
    department: hide ? null : author.department || null,
    lab: hide ? null : author.lab || null,
    isPrivate: author.isPrivate,
  };
}

export function toPublicAuthorOrNull(
  author: AuthorIdentity | null | undefined,
  viewerCanSeeIdentity = false,
): PublicAuthor | null {
  return author ? toPublicAuthor(author, viewerCanSeeIdentity) : null;
}
