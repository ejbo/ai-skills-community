import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';

const schema = z.object({
  installed: z.array(
    z.object({
      slug: z.string(),
      installed_version: z.string().optional(),
    }),
  ),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const slugs = parsed.data.installed.map((i) => i.slug);
  const skills = await prisma.skill.findMany({
    where: { slug: { in: slugs }, deletedAt: null, status: 'published' },
    include: { currentVersion: true },
  });
  const map = new Map(skills.map((s) => [s.slug, s]));

  const results = parsed.data.installed.map((entry) => {
    const skill = map.get(entry.slug);
    if (!skill || !skill.currentVersion) {
      return { slug: entry.slug, found: false };
    }
    const latest = skill.currentVersion.version;
    return {
      slug: entry.slug,
      found: true,
      installed_version: entry.installed_version,
      latest_version: latest,
      has_update: entry.installed_version !== latest,
      download_url: `/api/skills/${skill.slug}/download`,
      checksum: skill.currentVersion.checksumSha256,
    };
  });
  return NextResponse.json({ results });
}
