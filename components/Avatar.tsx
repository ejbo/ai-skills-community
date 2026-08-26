// Shared user avatar: shows the uploaded image when present, otherwise an
// initial badge tinted with a colour derived from the person's name.
// Server-safe (no hooks) so it works in both server and client components.
// Used in the navbar, comments, reviews, author bylines, cards, etc.

import { withBasePath } from '@/lib/base-path';

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE: Record<Size, string> = {
  xs: 'h-5 w-5 text-[10px]',
  sm: 'h-7 w-7 text-xs',
  md: 'h-8 w-8 text-sm',
  lg: 'h-10 w-10 text-base',
  xl: 'h-16 w-16 text-2xl',
};

/**
 * Identity palette. A person is not chrome — the whole point of a fallback
 * badge is that you recognise the same colleague in a comment thread, a card
 * byline and the member list without reading the name, which a grey disc can
 * never do. Twelve hues, all held at roughly the same lightness/chroma so a
 * list of them reads as one family rather than as confetti, and all dark
 * enough to carry white glyphs in either theme.
 */
const IDENTITY_COLORS = [
  '#B24357', // rose
  '#B85C2B', // clay
  '#8F7420', // ochre
  '#4C7F3F', // moss
  '#2F7F6B', // teal
  '#2C7391', // steel
  '#3E63A8', // cobalt
  '#5C5BA6', // indigo
  '#7C4F9B', // violet
  '#9E4278', // magenta
  '#6B6252', // taupe
  '#A8443C', // brick
] as const;

/** FNV-1a 32-bit — same person, same colour, on every surface and every render. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function identityColor(name: string): string {
  return IDENTITY_COLORS[fnv1a(name.trim().toLowerCase()) % IDENTITY_COLORS.length];
}

export function Avatar({
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
