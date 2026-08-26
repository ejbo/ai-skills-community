import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { loadOwnTags } from '@/lib/user-tags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — every tag assigned to me, hidden ones included, so 设置 can list them.
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const rows = await loadOwnTags(session.user.id);
  return NextResponse.json({
    tags: rows.map((r) => ({ ...r.tag, hidden: r.hidden })),
  });
}

const patchSchema = z.object({ key: z.string().min(1), hidden: z.boolean() });

// PATCH — show/hide one of MY tags on my card. It stays assigned either way:
// hiding is a display choice, not a way to shed a tag an admin granted.
export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const tag = await prisma.userTag.findUnique({
    where: { key: parsed.data.key },
    select: { id: true },
  });
  if (!tag) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const updated = await prisma.userTagAssignment.updateMany({
    where: { userId: session.user.id, tagId: tag.id },
    data: { hidden: parsed.data.hidden },
  });
  if (updated.count === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
