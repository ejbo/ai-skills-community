import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { resolveActor } from '@/lib/auth/either';
import { canAccessSkillContent } from '@/lib/access';
import { estimateTokenCost } from '@/lib/skill-parser';

const updateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  summary: z.string().min(1).max(200).optional(),
  // Public overview (Skill column). Capped for parity with video descriptionMd.
  descriptionMd: z.string().max(50000).optional(),
  // Gated SKILL.md body (currentVersion.contentInline) — updated separately below.
  bodyMd: z.string().optional(),
  categoryId: z.string().nullable().optional(),
  license: z.string().optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  visibility: z.enum(['public', 'restricted', 'private']).optional(),
  tokenCostEstimate: z.number().int().min(0).max(50000).optional(),
  tags: z.array(z.string()).optional(),
  triggers: z.array(z.string()).optional(),
});

async function loadOwned(slug: string, userId: string) {
  const skill = await prisma.skill.findUnique({ where: { slug } });
  if (!skill || skill.deletedAt) return null;
  if (skill.authorId !== userId) return 'forbidden' as const;
  return skill;
}

export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const skill = await prisma.skill.findUnique({
    where: { slug: params.slug },
    include: {
      author: { select: { handle: true, displayName: true } },
      currentVersion: true,
    },
  });
  if (!skill || skill.deletedAt) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const actor = await resolveActor(req);
  let grantStatus: string | null = null;
  if (actor && skill.visibility === 'restricted' && actor.id !== skill.authorId && !actor.isAdmin) {
    const g = await prisma.skillAccessRequest.findUnique({
      where: { skillId_userId: { skillId: skill.id, userId: actor.id } },
      select: { status: true },
    });
    grantStatus = g?.status ?? null;
  }
  const decision = canAccessSkillContent(skill, actor, grantStatus as never);
  const privileged = decision.kind === 'owner' || decision.kind === 'admin';

  // Hide drafts/archived and private skills from non-owners entirely.
  const canSeeMeta = privileged || (skill.status === 'published' && skill.visibility !== 'private');
  if (!canSeeMeta) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Strip content fields when the caller can't access content (restricted/un-granted).
  if (!decision.canContent && skill.currentVersion) {
    skill.currentVersion = {
      ...skill.currentVersion,
      storageUrl: null,
      contentInline: null,
      manifestJson: null,
      checksumSha256: null,
    };
  }

  return NextResponse.json({ skill, access: { canContent: decision.canContent, kind: decision.kind } });
}

export async function PUT(req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const owned = await loadOwned(params.slug, session.user.id);
  if (owned === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (owned === 'forbidden') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  // bodyMd → current version's gated content; tags/triggers have their own
  // tables / JSON column. Everything else maps straight onto Skill columns.
  const { bodyMd, tags, triggers, ...skillData } = parsed.data;
  const data: Record<string, unknown> = { ...skillData };
  if (triggers) {
    data.structuredPayload = { ...(owned.structuredPayload as object | null), triggers };
  }
  const updated = await prisma.skill.update({ where: { id: owned.id }, data });

  if (typeof bodyMd === 'string' && owned.currentVersionId) {
    await prisma.skillVersion.update({
      where: { id: owned.currentVersionId },
      data: { contentInline: bodyMd, tokenCost: estimateTokenCost(bodyMd) },
    });
  }

  if (tags) {
    // Replace the skill's tag set with the provided list.
    await prisma.skillTag.deleteMany({ where: { skillId: owned.id } });
    for (const tagName of tags) {
      const tagSlug = tagName.toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (!tagSlug) continue;
      const tag = await prisma.tag.upsert({
        where: { slug: tagSlug },
        update: {},
        create: { slug: tagSlug, name: tagName, usageCount: 1 },
      });
      await prisma.skillTag.upsert({
        where: { skillId_tagId: { skillId: owned.id, tagId: tag.id } },
        update: {},
        create: { skillId: owned.id, tagId: tag.id },
      });
    }
  }

  return NextResponse.json({ skill: updated });
}

export async function DELETE(_req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const owned = await loadOwned(params.slug, session.user.id);
  if (owned === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (owned === 'forbidden') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  await prisma.skill.update({
    where: { id: owned.id },
    data: { deletedAt: new Date(), status: 'archived' },
  });
  return NextResponse.json({ ok: true });
}
