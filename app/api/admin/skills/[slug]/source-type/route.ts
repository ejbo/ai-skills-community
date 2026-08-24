import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { gateApi } from '@/lib/admin';
import { logAdmin } from '@/lib/audit';

const schema = z.object({
  sourceType: z.enum(['internal', 'external', 'curated']),
});

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const gate = await gateApi('skills');
  if (!gate.ok) return gate.response;
  const { session } = gate;

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
