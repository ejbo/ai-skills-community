// Shared user avatar: shows the uploaded image when present, otherwise an
// initial badge tinted with a colour derived from the person's name.
// Server-safe (no hooks) so it works in both server and client components.
// Used in the navbar, comments, reviews, author bylines, cards, etc.

import { withBasePath } from '@/lib/base-path';
import { identityColor } from '@/lib/identity-color';
import { UserHoverCard } from '@/components/user/UserHoverCard';

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE: Record<Size, string> = {
  xs: 'h-5 w-5 text-[10px]',
  sm: 'h-7 w-7 text-xs',
  md: 'h-8 w-8 text-sm',
  lg: 'h-10 w-10 text-base',
  xl: 'h-16 w-16 text-2xl',
};

// Identity palette + hash live in lib/identity-color.ts (server modules need them
// without this file's client boundary); re-exported so existing imports keep working.
export { IDENTITY_COLORS, identityColor } from '@/lib/identity-color';

/**
 * Shared user avatar.
 *
 * Pass `handle` and the avatar becomes the entry point to that person's
 * 用户卡片 — hovering pops their profile. It lives HERE rather than at each call
 * site because "a user appears" and "an avatar is rendered" are the same event
 * across the app: wiring it once means every byline, comment, member list and
 * roster gets it, and a new surface gets it by default. Avatars with no handle
 * (a zone icon, a guest byline) render exactly as before.
 *
 * Still server-safe: UserHoverCard is a client component, so this just opens a
 * client boundary around markup the server already produced.
 */
export function Avatar({
  name,
  src,
  size = 'md',
  className = '',
  handle,
}: {
  name: string;
  src?: string | null;
  size?: Size;
  className?: string;
  /** Profile handle; when set the avatar carries the hover 用户卡片. */
  handle?: string | null;
}) {
  const inner = <AvatarImage name={name} src={src} size={size} className={className} />;
  if (!handle) return inner;
  return (
    <UserHoverCard handle={handle} className="inline-flex">
      {inner}
    </UserHoverCard>
  );
}

function AvatarImage({
  name,
  src,
  size = 'md',
  className = '',
}: {
  name: string;
  src?: string | null;
  size?: Size;
  className?: string;
}) {
  const dims = SIZE[size];
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- same-origin user upload, no Next Image config needed
    return (
      <img
        src={withBasePath(src)}
        alt={name}
        className={`${dims} shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }
  const label = name?.trim() || 'U';
  const initial = (label.charAt(0) || 'U').toUpperCase();
  return (
    <span
      className={`flex ${dims} shrink-0 items-center justify-center rounded-full font-semibold uppercase text-white ${className}`}
      style={{ backgroundColor: identityColor(label) }}
      aria-hidden
    >
      {initial}
    </span>
  );
}
