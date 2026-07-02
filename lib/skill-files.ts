import type { SkillFormat } from '@prisma/client';
import { prisma } from '@/lib/db';
import { storage, skillBundleKey } from '@/lib/storage';
import { parseSkillBundle } from '@/lib/skill-parser';
import { assembleSkillContext } from '@/lib/skill-context';
import { synthesizeSkillMd } from '@/lib/skill-md';

export interface VersionFileMeta {
  path: string;
  size: number;
  isText: boolean;
}

// Structural shape of a skill loaded with its current version. Compatible with
// the objects returned by lib/access.loadAccessContext and lib/skill-queries.
export interface LoadedVersion {
  id: string;
  version: string;
  contentInline: string | null;
  storageUrl: string | null;
  manifestJson: unknown;
}
export interface LoadedSkill {
  slug: string;
  name: string;
  summary: string;
  descriptionMd: string;
  license: string | null;
  skillFormat: SkillFormat;
  currentVersion: LoadedVersion | null;
}

async function backfillVersionFiles(versionId: string, slug: string, version: string): Promise<void> {
  const key = skillBundleKey(slug, version);
  let buf: Buffer;
  try {
    buf = await storage.get(key);
  } catch {
    return;
  }
  const parsed = await parseSkillBundle(buf);
  if (parsed.files.length > 0) {
    await prisma.skillFile.createMany({
      data: parsed.files.map((file) => ({
        versionId,
        path: file.path,
        size: file.size,
        isText: file.isText,
        content: file.content,
        truncated: file.truncated,
      })),
      skipDuplicates: true,
    });
  }
}

export async function getSkillFileList(
  skill: LoadedSkill,
): Promise<{ versionId: string; files: VersionFileMeta[] } | null> {
  if (!skill.currentVersion) return null;
  const version = skill.currentVersion;

  if (skill.skillFormat === 'structured') {
    return {
      versionId: version.id,
      files: [{ path: 'SKILL.md', size: (version.contentInline ?? '').length, isText: true }],
    };
  }

  let rows = await prisma.skillFile.findMany({
    where: { versionId: version.id },
    select: { path: true, size: true, isText: true },
  });
  if (rows.length === 0 && version.storageUrl) {
    await backfillVersionFiles(version.id, skill.slug, version.version);
    rows = await prisma.skillFile.findMany({
      where: { versionId: version.id },
      select: { path: true, size: true, isText: true },
    });
  }
  return { versionId: version.id, files: rows };
}

export type FileContentResult =
  | { ok: true; path: string; isText: boolean; content: string | null; truncated: boolean; size: number }
  | { ok: false; status: number };

export async function getSkillFileContent(skill: LoadedSkill, path: string): Promise<FileContentResult> {
  if (!skill.currentVersion) return { ok: false, status: 404 };
  const version = skill.currentVersion;

  if (skill.skillFormat === 'structured') {
    if (path !== 'SKILL.md') return { ok: false, status: 404 };
    const content = synthesizeSkillMd(skill, version);
    return { ok: true, path, isText: true, content, truncated: false, size: content.length };
  }

  let row = await prisma.skillFile.findUnique({
    where: { versionId_path: { versionId: version.id, path } },
  });
  if (!row && version.storageUrl) {
    await backfillVersionFiles(version.id, skill.slug, version.version);
    row = await prisma.skillFile.findUnique({
      where: { versionId_path: { versionId: version.id, path } },
    });
  }
  if (!row) return { ok: false, status: 404 };
  return {
    ok: true,
    path: row.path,
    isText: row.isText,
    content: row.content,
    truncated: row.truncated,
    size: row.size,
  };
}

// Assemble the full-skill AI context (SKILL.md + supporting text files) from an
// already-loaded skill. Caller is responsible for access control. `maxChars`
// lets latency-sensitive callers (comparison workshop) take a smaller slice;
// interactive chat keeps the full default.
export async function buildContextFromSkill(
  skill: LoadedSkill,
  maxChars?: number,
): Promise<string | null> {
  if (!skill.currentVersion) return null;
  const version = skill.currentVersion;
  const skillMd = version.contentInline ?? skill.descriptionMd ?? '';

  let files: { path: string; content: string | null; isText: boolean }[] = [];
  if (skill.skillFormat === 'bundle') {
    let rows = await prisma.skillFile.findMany({
      where: { versionId: version.id },
      select: { path: true, content: true, isText: true },
    });
    if (rows.length === 0 && version.storageUrl) {
      await backfillVersionFiles(version.id, skill.slug, version.version);
      rows = await prisma.skillFile.findMany({
        where: { versionId: version.id },
        select: { path: true, content: true, isText: true },
      });
    }
    files = rows;
  }
  return assembleSkillContext({ name: skill.name, summary: skill.summary }, skillMd, files, maxChars);
}
