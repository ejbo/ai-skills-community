// People search shared by the @人 picker and the 合著者 picker. Pure and
// import-free (unit-tested in tests/user-search.test.ts) — the route does the
// Prisma prefilter, this module decides what actually matches and how it ranks.
//
// Prisma cannot express "the digits of this column", so every query here is a
// two-step of the shape the 员工名单 contract already uses (CLAUDE.md): a broad
// `contains` PREFILTER in SQL, then an exact re-check in app code. Never trust
// the prefilter alone.
//
// What "smart" means for the owner who asked for it:
//   - case-insensitive everywhere;
//   - name tokens match in ANY order, so `wang wei` finds `Wei Wang` and
//     `王伟` finds `王伟` — every token must appear somewhere in the person;
//   - 工号 matches on its DIGIT RUN, so `84412632`, `z84412632` and the
//     fullwidth `ｚ８４４１２６３２` are one person (the SSO uid is the bare
//     number while rosters carry the letter-prefixed account).

import { accountMatchKey, canonicalAccountText } from './employee-directory';

/** A person as the pickers need them; the route builds this from PublicAuthor + ids. */
export interface SearchablePerson {
  userId: string;
  handle: string;
  displayName: string;
  /** 工号 as stored (`User.huaweiW3Id`), or null for a password-only account. */
  accountNumber?: string | null;
  /** The W3 display name when it differs from `displayName`. */
  altName?: string | null;
}

/** Folded search tokens: NFKC, lowercase, whitespace-split, empties dropped. */
export function searchTokens(query: string): string[] {
  return (query ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);
}

/** Everything about a person a token may match, folded once. */
function haystack(p: SearchablePerson): string[] {
  return [p.displayName, p.handle, p.altName]
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .map((v) => v.normalize('NFKC').toLowerCase());
}

/**
 * True when `token` identifies this person by 工号: the token's digit run equals
 * the account's. A token with no digits never matches this way (it would make
 * every letter-prefixed account match every word).
 */
export function matchesAccount(token: string, accountNumber: string | null | undefined): boolean {
  if (!accountNumber) return false;
  const key = accountMatchKey(accountNumber);
  if (!key) return false;
  const tokenDigits = canonicalAccountText(token).replace(/\D+/g, '');
  if (!tokenDigits) return false;
  // Prefix, so typing the first digits of a 工号 narrows as you go; the full
  // number is the exact case. Leading zeros are significant on both sides.
  return key.startsWith(tokenDigits);
}

/** True when EVERY token matches this person by name, handle, or 工号. */
export function matchesPerson(tokens: readonly string[], p: SearchablePerson): boolean {
  if (tokens.length === 0) return false;
  const fields = haystack(p);
  return tokens.every((tok) => fields.some((f) => f.includes(tok)) || matchesAccount(tok, p.accountNumber));
}

/**
 * Rank: exact 工号 first (the unambiguous identifier), then a name that STARTS
 * with the query (what someone typing a name expects), then the rest by name.
 * Stable within a bucket so the SQL order (displayName asc) shows through.
 */
export function rankPeople<T extends SearchablePerson>(tokens: readonly string[], people: readonly T[]): T[] {
  const joined = tokens.join(' ');
  const score = (p: T): number => {
    if (tokens.some((t) => matchesAccount(t, p.accountNumber) && accountMatchKey(p.accountNumber) === canonicalAccountText(t).replace(/\D+/g, ''))) return 0;
    const name = p.displayName.normalize('NFKC').toLowerCase();
    if (name.startsWith(joined)) return 1;
    if (haystack(p).some((f) => f.startsWith(joined))) return 2;
    return 3;
  };
  return people
    .map((p, i) => ({ p, i, s: score(p) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.p);
}

/** Filter + rank in one call: what the route returns after its SQL prefilter. */
export function searchPeople<T extends SearchablePerson>(query: string, people: readonly T[], take = 8): T[] {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return [];
  return rankPeople(tokens, people.filter((p) => matchesPerson(tokens, p))).slice(0, Math.max(1, take));
}

/**
 * The `contains` terms the SQL prefilter should OR together. Digits-only tokens
 * also probe the 工号 column; everything probes the name columns. Kept separate
 * from the matcher so a widening of the prefilter can never widen the result.
 */
export function prefilterTerms(query: string): string[] {
  return searchTokens(query).slice(0, 3);
}
