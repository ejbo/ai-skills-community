import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { resolveActor } from '@/lib/auth/either';
import { canAccessSkillContent } from '@/lib/access';

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

  const actor = await resolveActor(req);
  const slugs = parsed.data.installed.map((i) => i.slug);
  const skills = await prisma.skill.findMany({
    where: { slug: { in: slugs }, deletedAt: null, status: 'published' },
    include: { currentVersion: true },
  });
  const map = new Map(skills.map((s) => [s.slug, s]));

  // Bulk-load this actor's grants for any restricted skills so revocation is honored.
  const restrictedIds = skills.filter((s) => s.visibility === 'restricted').map((s) => s.id);
  const grantMap = new Map<string, string>();
  if (actor && restrictedIds.length > 0) {
    const grants = await prisma.skillAccessRequest.findMany({
      where: { userId: actor.id, skillId: { in: restrictedIds } },
      select: { skillId: true, status: true },
    });
    for (const g of grants) grantMap.set(g.skillId, g.status);
  }

  const results = parsed.data.installed.map((entry) => {
    const skill = map.get(entry.slug);
    if (!skill || !skill.currentVersion) return { slug: entry.slug, found: false };
    const decision = canAccessSkillContent(skill, actor, (grantMap.get(skill.id) as never) ?? null);
    // Don't leak private/un-granted skills or advertise updates the caller can't fetch.
    if (!decision.canContent) return { slug: entry.slug, found: false };

    const latest = skill.currentVersion.version;
    return {
      slug: entry.slug,
      found: true,
      installed_version: entry.installed_version,
      latest_version: latest,
      has_update: entry.installed_version !== latest,
      download_url: `/api/skills/${skill.slug}/raw?version=${encodeURIComponent(latest)}&via=update`,
      checksum: skill.currentVersion.checksumSha256,
    };
  });
  return NextResponse.json({ results });
}
