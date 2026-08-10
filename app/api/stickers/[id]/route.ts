import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { toStickerDto } from '@/lib/sticker-queries';

export const dynamic = 'force-dynamic';

const patchSchema = z
  .object({
    favorited: z.boolean().optional(),
    // Marks the sticker as just-inserted (最近 tab); fired-and-forgot by the picker.
    used: z.literal(true).optional(),
  })
  .refine((v) => v.favorited !== undefined || v.used, { message: 'empty_patch' });

// PATCH /api/stickers/[id] — favorite toggle and/or last-used bump (own rows only).
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const data: { favorited?: boolean; lastUsedAt?: Date } = {};
  if (parsed.data.favorited !== undefined) data.favorited = parsed.data.favorited;
  if (parsed.data.used) data.lastUsedAt = new Date();

  // updateMany so the userId filter rides the write — no read-then-act gap.
  const res = await prisma.userSticker.updateMany({
    where: { id: params.id, userId: session.user.id },
    data,
  });
  if (res.count === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const row = await prisma.userSticker.findUnique({ where: { id: params.id } });
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true, sticker: toStickerDto(row) });
}

// DELETE /api/stickers/[id] — remove from MY library only. The file is
// deliberately NOT unlinked: other users' libraries and already-sent messages
// may reference the same key (same never-GC policy as editor images).
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const res = await prisma.userSticker.deleteMany({
    where: { id: params.id, userId: session.user.id },
  });
  if (res.count === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
