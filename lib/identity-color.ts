// 身份色 — the 12-hue identity palette and the name → hue hash.
//
// Import-free and client-safe. It used to live inside components/Avatar.tsx,
// which is still where most callers import it from (Avatar re-exports both
// names), but Avatar opens a client boundary around UserHoverCard — a server
// module such as lib/profile/card-view.ts (the 名片 theme falls back to this
// colour) must not drag that component graph into an API route bundle.
//
// A person is not chrome — the whole point of a fallback badge is that you
// recognise the same colleague in a comment thread, a card byline and the
// member list without reading the name, which a grey disc can never do. Twelve
// hues, all held at roughly the same lightness/chroma so a list of them reads
// as one family rather than as confetti, and all dark enough to carry white
// glyphs in either theme.

/** The 12-hue identity palette — a 版块's theme swatches are the SAME colours a person's avatar hashes to. */
export const IDENTITY_COLORS = [
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
