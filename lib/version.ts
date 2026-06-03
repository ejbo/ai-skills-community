// Pure semver helpers for skill version management. Skill versions are strict
// `major.minor.patch` (no pre-release / build metadata) — see SkillVersion.

export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

/** Parse a strict `x.y.z` (non-negative integers). Returns null if malformed. */
export function parseSemver(raw: string): Semver | null {
  const m = raw.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  const [major, minor, patch] = [m[1], m[2], m[3]].map((n) => Number.parseInt(n, 10));
  if ([major, minor, patch].some((n) => !Number.isFinite(n) || n < 0)) return null;
  return { major, minor, patch };
}

/** -1 if a<b, 0 if equal, 1 if a>b. */
export function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

export function formatSemver(v: Semver): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

/** Next patch version as a string, e.g. {1,2,0} → "1.2.1". */
export function bumpPatch(v: Semver): string {
  return formatSemver({ ...v, patch: v.patch + 1 });
}
