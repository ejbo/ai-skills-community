import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { logAdmin } from '@/lib/audit';

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(200).optional(),
  sortOrder: z.number().int().optional(),
});

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const before = await prisma.category.findUnique({ where: { id: params.id } });
  if (!before) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const updated = await prisma.category.update({ where: { id: params.id }, data: parsed.data });
  await logAdmin({
    adminUserId: session.user.id,
    action: 'update_category',
    targetType: 'category',
    targetId: params.id,
    details: { before, after: parsed.data },
  });
  return NextResponse.json({ ok: true, category: updated });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const before = await prisma.category.findUnique({ where: { id: params.id } });
  if (!before) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Skills with this category get `categoryId = null` via Prisma's SetNull rule.
  await prisma.category.delete({ where: { id: params.id } });
  await logAdmin({
    adminUserId: session.user.id,
    action: 'delete_category',
    targetType: 'category',
    targetId: params.id,
    details: { slug: before.slug, name: before.name },
  });
  return NextResponse.json({ ok: true });
}
