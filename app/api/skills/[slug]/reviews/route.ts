import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  bodyMd: z.string().max(2000).default(''),
});

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const skill = await prisma.skill.findUnique({ where: { slug: params.slug }, select: { id: true } });
  if (!skill) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const reviews = await prisma.review.findMany({
    where: { skillId: skill.id },
    orderBy: { createdAt: 'desc' },
    include: {
      author: { select: { handle: true, displayName: true } },
    },
  });
  return NextResponse.json({ reviews });
}

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const skill = await prisma.skill.findUnique({ where: { slug: params.slug } });
  if (!skill || skill.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (skill.authorId === session.user.id) {
    return NextResponse.json({ error: 'cannot_review_own' }, { status: 400 });
  }

  await prisma.review.upsert({
    where: { skillId_authorId: { skillId: skill.id, authorId: session.user.id } },
    create: {
      skillId: skill.id,
      authorId: session.user.id,
      versionId: skill.currentVersionId,
      rating: parsed.data.rating,
      bodyMd: parsed.data.bodyMd,
    },
    update: {
      rating: parsed.data.rating,
      bodyMd: parsed.data.bodyMd,
    },
  });

  // Recompute aggregates
  const stats = await prisma.review.aggregate({
    where: { skillId: skill.id },
    _avg: { rating: true },
    _count: true,
  });
  await prisma.skill.update({
    where: { id: skill.id },
    data: {
      avgRating: stats._avg.rating ?? 0,
      reviewCount: stats._count,
    },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const skill = await prisma.skill.findUnique({ where: { slug: params.slug }, select: { id: true } });
  if (!skill) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await prisma.review.delete({
    where: { skillId_authorId: { skillId: skill.id, authorId: session.user.id } },
  }).catch(() => undefined);

  const stats = await prisma.review.aggregate({
    where: { skillId: skill.id },
    _avg: { rating: true },
    _count: true,
  });
  await prisma.skill.update({
    where: { id: skill.id },
    data: {
      avgRating: stats._avg.rating ?? 0,
      reviewCount: stats._count,
    },
  });

  return NextResponse.json({ ok: true });
}
