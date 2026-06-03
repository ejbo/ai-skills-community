import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

const schema = z.object({
  slug: z.string().min(2).max(64).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'invalid slug'),
  name: z.string().min(2).max(120),
  summary: z.string().min(1).max(200),
  descriptionMd: z.string().default(''), // public overview
  bodyMd: z.string().default(''), // gated SKILL.md body
  categoryId: z.string().nullable().optional(),
  license: z.string().default('MIT'),
  tokenCostEstimate: z.number().int().min(0).max(50000).default(0),
  publish: z.boolean().default(false),
});

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const source = await prisma.skill.findUnique({
    where: { slug: params.slug },
    include: { currentVersion: true },
  });
  if (!source || source.deletedAt || source.status !== 'published') {
    return NextResponse.json({ error: 'source_not_found' }, { status: 404 });
  }

  const existing = await prisma.skill.findUnique({ where: { slug: parsed.data.slug } });
  if (existing) return NextResponse.json({ error: 'slug_taken' }, { status: 409 });

  const input = parsed.data;

  const created = await prisma.$transaction(async (tx) => {
    const skill = await tx.skill.create({
      data: {
        slug: input.slug,
        name: input.name,
        summary: input.summary,
        descriptionMd: input.descriptionMd,
        authorId: session.user.id,
        categoryId: input.categoryId ?? source.categoryId,
        sourceType: 'user_uploaded',
        skillFormat: 'structured',
        status: input.publish ? 'published' : 'draft',
        tokenCostEstimate: input.tokenCostEstimate,
        license: input.license,
        forkedFromId: source.id,
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
        manifestJson: { name: skill.name, description: skill.summary, license: input.license },
        tokenCost: input.tokenCostEstimate,
        status: input.publish ? 'published' : 'draft',
        publishedAt: input.publish ? new Date() : null,
      },
    });
    await tx.skill.update({
      where: { id: skill.id },
      data: { currentVersionId: version.id },
    });
    await tx.skill.update({
      where: { id: source.id },
      data: { remixCount: { increment: 1 } },
    });
    return skill;
  });

  return NextResponse.json({ ok: true, skill: { slug: created.slug, id: created.id } });
}
