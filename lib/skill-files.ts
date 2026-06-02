import yaml from 'js-yaml';
import { prisma } from '@/lib/db';
import { storage, skillBundleKey } from '@/lib/storage';
import { parseSkillBundle } from '@/lib/skill-parser';
import { assembleSkillContext } from '@/lib/skill-context';

export interface VersionFileMeta {
  path: string;
  size: number;
  isText: boolean;
}

interface SkillForSynth {
  name: string;
  summary: string;
  license: string | null;
  descriptionMd: string;
}
interface VersionForSynth {
  version: string;
  manifestJson: unknown;
  contentInline: string | null;
}

function synthesizeSkillMd(skill: SkillForSynth, version: VersionForSynth): string {
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
  const body = version.contentInline ?? skill.descriptionMd ?? '';
  return `---\n${yaml.dump(frontmatter).trim()}\n---\n\n${body}`;
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
  slug: string,
): Promise<{ versionId: string; files: VersionFileMeta[] } | null> {
  const skill = await prisma.skill.findUnique({ where: { slug }, include: { currentVersion: true } });
  if (!skill || skill.deletedAt || skill.status !== 'published' || !skill.currentVersion) return null;
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
    await backfillVersionFiles(version.id, slug, version.version);
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

export async function getSkillFileContent(slug: string, path: string): Promise<FileContentResult> {
  const skill = await prisma.skill.findUnique({ where: { slug }, include: { currentVersion: true } });
  if (!skill || skill.deletedAt || skill.status !== 'published' || !skill.currentVersion) {
    return { ok: false, status: 404 };
  }
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
    await backfillVersionFiles(version.id, slug, version.version);
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

export async function getSkillContextForSlug(slug: string): Promise<string | null> {
  const skill = await prisma.skill.findUnique({ where: { slug }, include: { currentVersion: true } });
  if (!skill || skill.deletedAt || skill.status !== 'published' || !skill.currentVersion) return null;
  const version = skill.currentVersion;
  const skillMd = version.contentInline ?? skill.descriptionMd ?? '';

  let files: { path: string; content: string | null; isText: boolean }[] = [];
  if (skill.skillFormat === 'bundle') {
    let rows = await prisma.skillFile.findMany({
      where: { versionId: version.id },
      select: { path: true, content: true, isText: true },
    });
    if (rows.length === 0 && version.storageUrl) {
      await backfillVersionFiles(version.id, slug, version.version);
      rows = await prisma.skillFile.findMany({
        where: { versionId: version.id },
        select: { path: true, content: true, isText: true },
      });
    }
    files = rows;
  }
  return assembleSkillContext({ name: skill.name, summary: skill.summary }, skillMd, files);
}
