import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { browseSkills } from '@/lib/skill-queries';

const createSchema = z.object({
  slug: z.string().min(2).max(64).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'Invalid slug'),
  name: z.string().min(2).max(120),
  summary: z.string().min(1).max(200),
  // Public overview (shown to everyone, incl. anonymous on restricted skills).
  descriptionMd: z.string().max(50000).default(''),
  // The SKILL.md body — gated content for restricted skills (never public).
  bodyMd: z.string().default(''),
  categoryId: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  triggers: z.array(z.string()).default([]),
  license: z.string().default('MIT'),
  sourceType: z.enum(['internal', 'user_uploaded']).default('user_uploaded'),
  skillFormat: z.enum(['bundle', 'structured']).default('structured'),
  visibility: z.enum(['public', 'restricted', 'private']).default('public'),
  tokenCostEstimate: z.number().int().min(0).max(50000).default(0),
  publish: z.boolean().default(false),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sp = url.searchParams;
  const res = await browseSkills({
    q: sp.get('q') ?? undefined,
    category: sp.get('category') ?? undefined,
    tag: sp.get('tag') ?? undefined,
    source: (sp.get('source') as 'internal' | 'user_uploaded' | 'external_curated' | 'all' | null) ?? 'all',
    sort: (sp.get('sort') as 'trending' | 'downloads' | 'newest' | 'top_rated' | null) ?? 'trending',
    page: Number(sp.get('page') ?? 1),
    pageSize: Number(sp.get('pageSize') ?? 24),
    minRating: Number(sp.get('minRating') ?? 0),
  });
  return NextResponse.json(res);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_input', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const input = parsed.data;

  if (input.sourceType === 'internal' && !session.user.isAdmin) {
    return NextResponse.json({ error: 'forbidden_internal' }, { status: 403 });
  }

  const existing = await prisma.skill.findUnique({ where: { slug: input.slug } });
  if (existing) {
    return NextResponse.json({ error: 'slug_taken' }, { status: 409 });
  }

  const tokenCost = input.tokenCostEstimate;

  const created = await prisma.$transaction(async (tx) => {
    const skill = await tx.skill.create({
      data: {
        slug: input.slug,
        name: input.name,
        summary: input.summary,
        descriptionMd: input.descriptionMd,
        authorId: session.user.id,
        categoryId: input.categoryId ?? null,
        sourceType: input.sourceType,
        skillFormat: input.skillFormat,
        status: input.publish ? 'published' : 'draft',
        visibility: input.visibility,
        tokenCostEstimate: tokenCost,
        license: input.license,
        structuredPayload: {
          triggers: input.triggers,
        },
      },
    });

    const version = await tx.skillVersion.create({
      data: {
        skillId: skill.id,
        version: '1.0.0',
        major: 1,
        minor: 0,
        patch: 0,
        contentInline: input.bodyMd,
        manifestJson: {
          name: skill.name,
          description: skill.summary,
          triggers: input.triggers,
          license: input.license,
        },
        tokenCost,
        status: input.publish ? 'published' : 'draft',
        publishedAt: input.publish ? new Date() : null,
      },
    });

    const updated = await tx.skill.update({
      where: { id: skill.id },
      data: { currentVersionId: version.id },
    });

    if (input.tags.length > 0) {
      for (const tagSlug of input.tags) {
        const slug = tagSlug.toLowerCase().replace(/[^a-z0-9-]/g, '');
        if (!slug) continue;
        const tag = await tx.tag.upsert({
          where: { slug },
          update: { usageCount: { increment: 1 } },
          create: { slug, name: tagSlug, usageCount: 1 },
        });
        await tx.skillTag.upsert({
          where: { skillId_tagId: { skillId: skill.id, tagId: tag.id } },
          update: {},
          create: { skillId: skill.id, tagId: tag.id },
        });
      }
    }

    return updated;
  });

  return NextResponse.json({ ok: true, skill: created });
}
