import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

export async function POST(_req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const skill = await prisma.skill.findUnique({ where: { slug: params.slug } });
  if (!skill || skill.deletedAt) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const existing = await prisma.favorite.findUnique({
    where: { userId_skillId: { userId: session.user.id, skillId: skill.id } },
  });
  if (existing) {
    await prisma.$transaction([
      prisma.favorite.delete({ where: { userId_skillId: { userId: session.user.id, skillId: skill.id } } }),
      prisma.skill.update({ where: { id: skill.id }, data: { favoriteCount: { decrement: 1 } } }),
    ]);
    return NextResponse.json({ favorited: false });
  }
  await prisma.$transaction([
    prisma.favorite.create({ data: { userId: session.user.id, skillId: skill.id } }),
    prisma.skill.update({ where: { id: skill.id }, data: { favoriteCount: { increment: 1 } } }),
  ]);
  return NextResponse.json({ favorited: true });
}
