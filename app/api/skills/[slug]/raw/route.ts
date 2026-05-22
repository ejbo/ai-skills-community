import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import yaml from 'js-yaml';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { storage } from '@/lib/storage';

function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const url = new URL(req.url);
  const versionArg = url.searchParams.get('version');
  const session = await auth();

  const skill = await prisma.skill.findUnique({
    where: { slug: params.slug },
    include: { currentVersion: true },
  });
  if (!skill || skill.deletedAt || skill.status !== 'published') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const version = versionArg
    ? await prisma.skillVersion.findUnique({
        where: { skillId_version: { skillId: skill.id, version: versionArg } },
      })
    : skill.currentVersion;

  if (!version || version.status !== 'published') {
    return NextResponse.json({ error: 'version_not_found' }, { status: 404 });
  }

  // Best-effort download log (don't block the response)
  prisma
    .$transaction([
      prisma.skill.update({
        where: { id: skill.id },
        data: { downloadCount: { increment: 1 } },
      }),
      prisma.download.create({
        data: {
          skillId: skill.id,
          versionId: version.id,
          userId: session?.user?.id,
          client: 'web',
          ipHash: hashIp(req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null),
        },
      }),
    ])
    .catch(() => undefined);

  // Bundle format: stream the original zip from storage
  if (skill.skillFormat === 'bundle' && version.storageUrl) {
    const match = version.storageUrl.match(/\/api\/storage\/(.+)$/);
    if (match) {
      try {
        const buf = await storage.get(match[1]);
        return new NextResponse(new Uint8Array(buf), {
          headers: {
            'content-type': 'application/zip',
            'content-disposition': `attachment; filename="${skill.slug}-${version.version}.zip"`,
          },
        });
      } catch {
        /* fall through to synthesized markdown */
      }
    }
  }

  // Structured / fallback: synthesize SKILL.md with YAML frontmatter
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
  const content = `---\n${yaml.dump(frontmatter).trim()}\n---\n\n${body}`;

  return new NextResponse(content, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="${skill.slug}-${version.version}.md"`,
    },
  });
}
