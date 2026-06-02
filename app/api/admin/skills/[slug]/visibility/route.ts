import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { logAdmin } from '@/lib/audit';

const schema = z.object({
  visibility: z.enum(['public', 'restricted', 'private']),
});

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user?.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const before = await prisma.skill.findUnique({
    where: { slug: params.slug },
    select: { id: true, visibility: true },
  });
  if (!before) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await prisma.skill.update({
    where: { id: before.id },
    data: { visibility: parsed.data.visibility },
  });

  await logAdmin({
    adminUserId: session.user.id,
    action: 'update_skill_visibility',
    targetType: 'skill',
    targetId: params.slug,
    details: { before: before.visibility, after: parsed.data.visibility },
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
  });

  return NextResponse.json({ ok: true });
}
