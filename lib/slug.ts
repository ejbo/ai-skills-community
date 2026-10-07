// Title-derived URL slugs — ONE implementation for every surface.
//
// Owner, 2026-10-07: 「链接要能看出内容，不要 hash code；中文标题直接放进链接也可以」.
// So a slug keeps the title's letters and digits in ANY script — `大模型推理优化实践`,
// `claude-code-实战指南`, `attention-is-all-you-need` — and never falls back to a
// random id. Collisions get `-2`, `-3` … (never a hash), and an empty title gets
// the caller's fallback word.
//
// Import-free on purpose (no prisma, no nanoid): route pages, API routes,
// scripts and client components all share it. The DB side is the caller's —
// `allocateSlug` takes the slugs already taken under the base and only decides.
//
// Contract (docs/contracts/slugs.md):
//  - A slug is assigned at creation from the title. It may follow the title while
//    the item is unpublished; once others can see it the slug is FROZEN (links
//    must not break). A slug that is ever retired becomes a SlugAlias row and
//    the route redirects it to the current one.
//  - Routes keyed by `[id]` accept a slug OR the row id (old links, notification
//    deep links and `[embed:…]` refs keep working). Embeds/API keep using ids.
//  - Route params are passed through `decodeSlugParam` before lookup.

/** Code points kept from a title. CJK titles are dense, so this is plenty. */
export const SLUG_MAX = 60;

/** Letters/digits (and their combining signs — Devanagari vowels, kana voicing) of any script stay. */
const NON_WORD = /[^\p{L}\p{N}\p{M}]+/gu;
/** Only the Latin diacritics block is folded away; other scripts' marks are part of the letter. */
const LATIN_DIACRITICS = /[\u0300-\u036f]+/g;

/**
 * The readable slug for a title (may be '' — then the caller's fallback is used).
 * Latin diacritics are folded (`Café` → `cafe`), case is folded, CJK is kept as is.
 */
export function titleSlug(title: string, max = SLUG_MAX): string {
  const words = (title ?? '')
    .normalize('NFKD')
    .replace(LATIN_DIACRITICS, '')
    // Recompose what NFKD split apart that is not a Latin diacritic (Hangul, kana voicing).
    .normalize('NFC')
    .toLowerCase()
    .replace(NON_WORD, '-')
    .replace(/^-+|-+$/g, '');
  const points = Array.from(words);
  if (points.length <= max) return words;
  // Cut by code point, then back up to the last separator when that keeps
  // most of the budget — "attention-is-all-yo" reads worse than "attention-is-all".
  const cut = points.slice(0, max).join('');
  const lastDash = cut.lastIndexOf('-');
  const trimmed = lastDash >= Math.floor(cut.length / 2) ? cut.slice(0, lastDash) : cut;
  return trimmed.replace(/-+$/g, '');
}

/**
 * Pick the first free slug: `base`, then `base-2`, `base-3` …
 * `taken` = the slugs that already start with `base` (one `startsWith` query);
 * `reserved` = static route segments the slug must not shadow (`new`, `edit`, …).
 */
export function allocateSlug(
  base: string,
  taken: Iterable<string>,
  opts: { fallback: string; reserved?: Iterable<string> },
): string {
  const root = base || opts.fallback;
  const blocked = new Set<string>(taken);
  for (const r of opts.reserved ?? []) blocked.add(r);
  if (!blocked.has(root)) return root;
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${root}-${n}`;
    if (!blocked.has(candidate)) return candidate;
  }
  // Unreachable in practice (10k same-titled rows); stay deterministic anyway.
  return `${root}-${blocked.size + 1}`;
}

/**
 * A route param as the slug it names. Next can hand a non-ASCII segment over
 * still percent-encoded; decoding is a no-op for an already-decoded one (our
 * slugs never contain `%`). NFC so a decomposed paste matches the stored form.
 */
export function decodeSlugParam(raw: string): string {
  let s = raw ?? '';
  if (s.includes('%')) {
    try {
      s = decodeURIComponent(s);
    } catch {
      /* malformed escape — look it up verbatim (it simply will not match) */
    }
  }
  return s.normalize('NFC');
}

/** True when `slugOrId` looks like a cuid row id rather than a slug (lookup order hint only). */
export function looksLikeCuid(slugOrId: string): boolean {
  return /^c[a-z0-9]{20,32}$/.test(slugOrId);
}
