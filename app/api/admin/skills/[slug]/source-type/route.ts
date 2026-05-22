import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { logAdmin } from '@/lib/audit';

const schema = z.object({
  sourceType: z.enum(['internal', 'user_uploaded', 'external_curated']),
});

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user?.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const before = await prisma.skill.findUnique({
    where: { slug: params.slug },
    select: { id: true, sourceType: true },
  });
  if (!before) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await prisma.skill.update({
    where: { id: before.id },
    data: { sourceType: parsed.data.sourceType },
  });

  await logAdmin({
    adminUserId: session.user.id,
    action: 'update_skill_source_type',
    targetType: 'skill',
    targetId: params.slug,
    details: { before: before.sourceType, after: parsed.data.sourceType },
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
  });

  return NextResponse.json({ ok: true });
}
