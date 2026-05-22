import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

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

  await prisma.$transaction([
    prisma.skill.update({
      where: { id: skill.id },
      data: { downloadCount: { increment: 1 } },
    }),
    prisma.download.create({
      data: {
        skillId: skill.id,
        versionId: version.id,
        userId: session?.user?.id,
        client: req.headers.get('user-agent')?.includes('skills-cli') ? 'cli' : 'web',
        ipHash: hashIp(req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null),
      },
    }),
  ]);

  return NextResponse.json({
    version: version.version,
    url: version.storageUrl,
    inline: version.contentInline,
    checksum: version.checksumSha256,
    manifest: version.manifestJson,
  });
}
