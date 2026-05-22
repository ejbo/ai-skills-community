import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { logAdmin } from '@/lib/audit';

const schema = z.object({
  slug: z.string().min(2).max(48).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'invalid slug'),
  name: z.string().min(1).max(80),
  description: z.string().max(200).default(''),
  sortOrder: z.number().int().default(0),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const existing = await prisma.category.findUnique({ where: { slug: parsed.data.slug } });
  if (existing) return NextResponse.json({ error: 'slug_taken' }, { status: 409 });

  const created = await prisma.category.create({ data: parsed.data });
  await logAdmin({
    adminUserId: session.user.id,
    action: 'create_category',
    targetType: 'category',
    targetId: created.id,
    details: { slug: created.slug, name: created.name },
  });

  return NextResponse.json({ ok: true, category: created });
}
