import yaml from 'js-yaml';
import { stripRichFormatting } from '@/lib/markdown-text';

/**
 * Pure SKILL.md synthesis — no DB/storage/env coupling, so it is safe to import
 * from API routes, the zip packager, and unit tests alike.
 */

export interface SkillMdSource {
  name: string;
  summary: string;
  descriptionMd: string;
  license: string | null;
}

export interface VersionMdSource {
  version: string;
  contentInline: string | null;
  manifestJson: unknown;
}

/**
 * Build a SKILL.md (YAML frontmatter + body) for a structured skill. The body
 * comes from the version's `contentInline` (the gated skill content) — NEVER
 * from `descriptionMd` (the public overview), except as a last-resort fallback
 * when no content is stored, so a restricted skill's overview can't leak here.
 */
export function synthesizeSkillMd(skill: SkillMdSource, version: VersionMdSource): string {
  const manifest = (version.manifestJson as Record<string, unknown> | null) ?? {};
  const frontmatter: Record<string, unknown> = {
    name: manifest.name ?? skill.name,
    description: manifest.description ?? skill.summary,
    version: version.version,
    license: skill.license ?? 'MIT',
  };
  if (Array.isArray(manifest.triggers) && manifest.triggers.length > 0) {
    frontmatter.triggers = manifest.triggers;
  }
  // The overview fallback was written in the site editor, so it may carry the
  // editor's formatting spans (`<span data-color="red">`). They mean nothing in
  // a SKILL.md that is installed into another agent's skill folder — strip them
  // (markdown and any other HTML stay). `contentInline` is the author's own
  // file and is served byte-for-byte.
  const body = version.contentInline ?? stripRichFormatting(skill.descriptionMd ?? '');
  return `---\n${yaml.dump(frontmatter).trim()}\n---\n\n${body}`;
}
