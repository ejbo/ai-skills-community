import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const token = await prisma.cliToken.findUnique({ where: { id: params.id } });
  if (!token || token.userId !== session.user.id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  await prisma.cliToken.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
