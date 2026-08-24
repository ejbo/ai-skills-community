import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { gateApi } from '@/lib/admin';
import { logAdmin } from '@/lib/audit';

const schema = z.object({
  status: z.enum(['draft', 'published', 'archived']),
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
    select: { id: true, status: true },
  });
  if (!before) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await prisma.skill.update({
    where: { id: before.id },
    data: { status: parsed.data.status },
  });

  await logAdmin({
    adminUserId: session.user.id,
    action: 'update_skill_status',
    targetType: 'skill',
    targetId: params.slug,
    details: { before: before.status, after: parsed.data.status },
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
  });

  return NextResponse.json({ ok: true });
}
