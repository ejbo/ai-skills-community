import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { estimateTokenCost } from '@/lib/skill-parser';

const updateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  summary: z.string().min(1).max(200).optional(),
  descriptionMd: z.string().optional(),
  categoryId: z.string().nullable().optional(),
  license: z.string().optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
});

async function loadOwned(slug: string, userId: string) {
  const skill = await prisma.skill.findUnique({ where: { slug } });
  if (!skill || skill.deletedAt) return null;
  if (skill.authorId !== userId) return 'forbidden' as const;
  return skill;
}

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
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
  return NextResponse.json({ skill });
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

  const tokenCost = parsed.data.descriptionMd
    ? estimateTokenCost(parsed.data.descriptionMd)
    : undefined;

  const updated = await prisma.skill.update({
    where: { id: owned.id },
    data: {
      ...parsed.data,
      ...(tokenCost ? { tokenCostEstimate: tokenCost } : {}),
    },
  });
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
