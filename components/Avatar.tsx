// Shared user avatar: shows the uploaded image when present, otherwise a colored
// initial badge. Server-safe (no hooks) so it works in both server and client
// components. Used in the navbar, comments, reviews, author bylines, cards, etc.

import { withBasePath } from '@/lib/base-path';

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE: Record<Size, string> = {
  xs: 'h-5 w-5 text-[10px]',
  sm: 'h-7 w-7 text-xs',
  md: 'h-8 w-8 text-sm',
  lg: 'h-10 w-10 text-base',
  xl: 'h-16 w-16 text-2xl',
};

export function Avatar({
  name,
  src,
  size = 'md',
  tone = 'solid',
  className = '',
}: {
  name: string;
  src?: string | null;
  size?: Size;
  /**
   * Fallback-badge style: `solid` (accent fill), `subtle` (tinted accent) or
   * `neutral` (grey). `neutral` exists for surfaces that carry no accent
   * colour at all, like the homepage; `solid` is the navbar default and must
   * not be redefined.
   */
  tone?: 'solid' | 'subtle' | 'neutral';
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
  const initial = (name?.trim()?.charAt(0) || 'U').toUpperCase();
  const toneCls =
    tone === 'neutral'
      ? 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200'
      : tone === 'subtle'
        ? 'bg-accent-500/15 text-accent-600 dark:text-accent-300'
        : // Ink, not accent: this is the navbar fallback badge, so an indigo
          // disc sat above every page as the loudest chroma in the chrome.
          'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900';
  return (
    <span
      className={`flex ${dims} shrink-0 items-center justify-center rounded-full font-semibold uppercase ${toneCls} ${className}`}
      aria-hidden
    >
      {initial}
    </span>
  );
}
