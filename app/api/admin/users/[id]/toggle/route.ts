import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { logAdmin } from '@/lib/audit';

const BOOL_FIELDS = ['isAdmin', 'isActive', 'canPublishSkills', 'canRemix', 'canUseCli'] as const;
const NUM_FIELDS = ['dailyDownloadLimit', 'dailyPublishLimit'] as const;
type BoolField = (typeof BOOL_FIELDS)[number];
type NumField = (typeof NUM_FIELDS)[number];

const schema = z.object({
  field: z.string(),
  value: z.union([z.boolean(), z.number().int().nonnegative().nullable()]),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const { field, value } = parsed.data;
  const isBool = (BOOL_FIELDS as readonly string[]).includes(field);
  const isNum = (NUM_FIELDS as readonly string[]).includes(field);
  if (!isBool && !isNum) return NextResponse.json({ error: 'unknown_field' }, { status: 400 });
  if (isBool && typeof value !== 'boolean')
    return NextResponse.json({ error: 'expected_boolean' }, { status: 400 });
  if (isNum && typeof value !== 'number' && value !== null)
    return NextResponse.json({ error: 'expected_number_or_null' }, { status: 400 });

  const before = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, [field]: true } as Record<string, true>,
  });
  if (!before) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const updated = await prisma.user.update({
    where: { id: params.id },
    data: { [field]: value } as Record<string, unknown>,
  });

  await logAdmin({
    adminUserId: session.user.id,
    action: 'update_user',
    targetType: 'user',
    targetId: params.id,
    details: { field, before: (before as Record<string, unknown>)[field], after: value },
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
  });

  return NextResponse.json({ ok: true, user: { id: updated.id, [field]: (updated as Record<string, unknown>)[field] } });
}
