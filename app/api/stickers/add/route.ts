import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { statImageFile } from '@/lib/uploads/image-storage';
import { MAX_STICKERS_PER_USER, STICKER_KEY_RE } from '@/lib/stickers';
import { toStickerDto } from '@/lib/sticker-queries';

export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;

const addSchema = z.object({ key: z.string().min(1).max(200) });

// POST /api/stickers/add — adopt a sticker seen in someone's message into MY
// library (WeChat's 添加到表情). The client extracts the key from the rendered
// img src; we NEVER trust it: the key must match the stickers/ namespace regex
// AND resolve to a real stored file. Re-adding is reported (`existed`), not
// duplicated — the (userId, fileKey) unique constraint is the arbiter.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const userId = session.user.id;

  const gate = rateLimit(`sticker:add:${userId}`, 60, MINUTE_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const key = parsed.data.key;
  if (!STICKER_KEY_RE.test(key) || !statImageFile(key)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const count = await prisma.userSticker.count({ where: { userId } });
  if (count >= MAX_STICKERS_PER_USER) {
    return NextResponse.json({ error: 'sticker_limit' }, { status: 400 });
  }

  try {
    const row = await prisma.userSticker.create({ data: { userId, fileKey: key } });
    return NextResponse.json({ ok: true, sticker: toStickerDto(row), existed: false });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const row = await prisma.userSticker.findUnique({
        where: { userId_fileKey: { userId, fileKey: key } },
      });
      if (row) return NextResponse.json({ ok: true, sticker: toStickerDto(row), existed: true });
    }
    return NextResponse.json({ error: 'add_failed' }, { status: 500 });
  }
}
