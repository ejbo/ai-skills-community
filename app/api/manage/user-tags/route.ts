import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { logAdmin } from '@/lib/audit';
import { TAG_COLORS } from '@/lib/user-tags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const tagSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,30}$/, 'key 需为小写字母/数字/下划线'),
  name: z.string().trim().min(1).max(24),
  description: z.string().trim().max(200).optional(),
  color: z.enum(TAG_COLORS),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

async function gate() {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) };
  if (!can(session.user, 'users')) {
    return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  }
  return { session };
}

// POST — create a MANUAL tag. `auto` tags are minted by the system only
// (lib/user-tags.ts), so an admin can never hand out a badge that is supposed
// to describe a fact about the member.
export async function POST(req: Request) {
  const g = await gate();
  if (g.error) return g.error;

  const parsed = tagSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_input', reason: parsed.error.issues[0]?.message ?? '参数无效' },
      { status: 400 },
    );
  }
  const exists = await prisma.userTag.findUnique({
    where: { key: parsed.data.key },
    select: { id: true },
  });
  if (exists) return NextResponse.json({ error: 'duplicate', reason: 'key 已存在' }, { status: 409 });

  const tag = await prisma.userTag.create({
    data: { ...parsed.data, kind: 'manual' },
    select: { id: true, key: true, name: true, description: true, color: true, kind: true, sortOrder: true },
  });
  await logAdmin({
    adminUserId: g.session!.user.id,
    action: 'create_user_tag',
    targetType: 'user_tag',
    targetId: tag.id,
    details: { key: tag.key },
  });
  return NextResponse.json({ ok: true, tag });
}

const patchSchema = tagSchema.partial().extend({ id: z.string().min(1) });

export async function PATCH(req: Request) {
  const g = await gate();
  if (g.error) return g.error;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const { id, key, ...rest } = parsed.data;

  const tag = await prisma.userTag.findUnique({ where: { id }, select: { kind: true } });
  if (!tag) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  // Renaming an auto tag is fine; changing its key would break the reconciler.
  const data = tag.kind === 'auto' ? rest : { ...rest, ...(key ? { key } : {}) };

  const updated = await prisma.userTag.update({
    where: { id },
    data,
    select: { id: true, key: true, name: true, description: true, color: true, kind: true, sortOrder: true },
  });
  await logAdmin({
    adminUserId: g.session!.user.id,
    action: 'update_user_tag',
    targetType: 'user_tag',
    targetId: id,
  });
  return NextResponse.json({ ok: true, tag: updated });
}

export async function DELETE(req: Request) {
  const g = await gate();
  if (g.error) return g.error;
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const tag = await prisma.userTag.findUnique({ where: { id }, select: { kind: true, key: true } });
  if (!tag) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (tag.kind === 'auto') {
    return NextResponse.json(
      { error: 'auto_tag', reason: '系统标签由规则维护，不能删除' },
      { status: 409 },
    );
  }
  await prisma.userTag.delete({ where: { id } });
  await logAdmin({
    adminUserId: g.session!.user.id,
    action: 'delete_user_tag',
    targetType: 'user_tag',
    targetId: id,
    details: { key: tag.key },
  });
  return NextResponse.json({ ok: true });
}
