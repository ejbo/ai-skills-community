import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { logAdmin } from '@/lib/audit';
import { apiReason } from '@/lib/api-errors';
import { toPublicAuthor } from '@/lib/user-identity';
import { SHORT_FEED_SELECT } from '@/lib/video/shorts-queries';
import { MAX_SHORT_CAPTION_CHARS, shortTitleFromCaption } from '@/lib/video/shorts-shared';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  caption: z.string().trim().min(1).max(MAX_SHORT_CAPTION_CHARS).optional(),
  featured: z.boolean().optional(),
});

// PATCH /api/shorts/[id] — caption edits are author-only; `featured` (精选,
// surfaces the short on the homepage strip) is admin-only. Same per-field
// permission branching as the discussion routes; /manage/shorts reuses this.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_input', reason: await apiReason('invalid_request') },
      { status: 400 },
    );
  }
  const { caption, featured } = parsed.data;

  const short = await prisma.video.findFirst({
    where: { id: params.id, isShort: true, deletedAt: null },
    select: { id: true, uploaderId: true, featured: true, title: true },
  });
  if (!short) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const isAuthor = short.uploaderId === session.user.id;
  if (caption !== undefined && !isAuthor) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const moderates = featured !== undefined;
  if (moderates && !can(session.user, 'shorts')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const updated = await prisma.video.update({
    where: { id: short.id },
    data: {
      ...(caption !== undefined
        ? { summary: caption, title: shortTitleFromCaption(caption) }
        : {}),
      ...(featured !== undefined
        ? { featured, featuredAt: featured ? new Date() : null }
        : {}),
    },
    select: SHORT_FEED_SELECT,
  });

  if (moderates) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'feature_short_video',
      targetType: 'video',
      targetId: short.id,
      details: { title: short.title, featured: { before: short.featured, after: featured } },
    });
  }

  return NextResponse.json({
    ok: true,
    short: { ...updated, uploader: toPublicAuthor(updated.uploader, can(session.user, 'identity')) },
  });
}

// DELETE /api/shorts/[id] — soft delete (deletedAt), author-or-admin. Stored
// files stay on disk (same policy as the admin video board — no GC exists).
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const short = await prisma.video.findFirst({
    where: { id: params.id, isShort: true, deletedAt: null },
    select: { id: true, uploaderId: true, title: true },
  });
  if (!short) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const isAuthor = short.uploaderId === session.user.id;
  if (!isAuthor && !can(session.user, 'shorts')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Guarded write: a concurrent delete finding no row is fine (idempotent).
  await prisma.video.updateMany({
    where: { id: short.id, deletedAt: null },
    data: { deletedAt: new Date(), featured: false, featuredAt: null },
  });

  if (!isAuthor) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'delete_short_video',
      targetType: 'video',
      targetId: short.id,
      details: { title: short.title },
    });
  }

  return NextResponse.json({ ok: true });
}
