import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { logAdmin } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  tagId: z.string().min(1),
  /** 工号 / handle, one per line or comma separated — the same paste the
   *  employee importer accepts, so bulk assignment is a copy-paste. */
  handles: z.array(z.string().trim().min(1)).min(1).max(500),
  action: z.enum(['grant', 'revoke']),
});

// POST — grant or revoke a tag for many members at once.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!can(session.user, 'users')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const { tagId, handles, action } = parsed.data;

  const tag = await prisma.userTag.findUnique({ where: { id: tagId }, select: { id: true, kind: true, key: true } });
  if (!tag) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (tag.kind === 'auto') {
    return NextResponse.json(
      { error: 'auto_tag', reason: '系统标签由规则自动授予，不能手工指派' },
      { status: 409 },
    );
  }

  // Match on handle case-insensitively — a pasted 工号 list is rarely uniform.
  const lowered = [...new Set(handles.map((h) => h.toLowerCase()))];
  const users = await prisma.user.findMany({
    where: { handle: { in: lowered, mode: 'insensitive' } },
    select: { id: true, handle: true },
  });
  const found = new Set(users.map((u) => u.handle.toLowerCase()));
  const missing = lowered.filter((h) => !found.has(h));

  if (action === 'grant') {
    await prisma.userTagAssignment.createMany({
      data: users.map((u) => ({ userId: u.id, tagId, grantedById: session.user.id })),
      skipDuplicates: true,
    });
  } else {
    await prisma.userTagAssignment.deleteMany({
      where: { tagId, userId: { in: users.map((u) => u.id) } },
    });
  }

  await logAdmin({
    adminUserId: session.user.id,
    action: action === 'grant' ? 'grant_user_tag' : 'revoke_user_tag',
    targetType: 'user_tag',
    targetId: tagId,
    details: { key: tag.key, matched: users.length, missing: missing.length },
  });
  return NextResponse.json({ ok: true, matched: users.length, missing });
}
