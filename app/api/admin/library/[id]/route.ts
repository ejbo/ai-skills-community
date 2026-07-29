import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { logAdmin } from '@/lib/audit';

const patchSchema = z.object({
  featured: z.boolean().optional(),
  docType: z.enum(['book', 'paper', 'blog', 'article', 'report', 'other']).optional(),
  restore: z.literal(true).optional(),
});

// PATCH /api/admin/library/[id] (admin) — 推荐 toggle, explicit 类型 (pins it so
// AI never overwrites), or restore of a soft-deleted doc.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const { featured, docType, restore } = parsed.data;
  if (featured === undefined && docType === undefined && !restore) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const doc = await prisma.libraryDoc.findUnique({
    where: { id: params.id },
    select: { id: true, slug: true },
  });
  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const data: Prisma.LibraryDocUpdateInput = {};
  const details: Record<string, unknown> = {};
  if (featured !== undefined) {
    data.featured = featured;
    data.featuredAt = featured ? new Date() : null;
    details.featured = featured;
  }
  if (docType !== undefined) {
    data.docType = docType;
    data.docTypePinned = true;
    details.docType = docType;
  }
  if (restore) {
    data.deletedAt = null;
    details.restore = true;
  }

  const updated = await prisma.libraryDoc.update({
    where: { id: doc.id },
    data,
    select: {
      id: true,
      slug: true,
      docType: true,
      docTypePinned: true,
      featured: true,
      featuredAt: true,
      deletedAt: true,
    },
  });

  await logAdmin({
    adminUserId: session.user.id,
    action: 'update_library_doc',
    targetType: 'library_doc',
    targetId: doc.id,
    details,
  });

  return NextResponse.json({ ok: true, doc: updated });
}

// DELETE /api/admin/library/[id] (admin) — soft delete; files and chapters stay
// so a restore brings the doc back intact.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const doc = await prisma.libraryDoc.findUnique({
    where: { id: params.id },
    select: { id: true, slug: true, title: true },
  });
  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await prisma.libraryDoc.update({
    where: { id: doc.id },
    data: { deletedAt: new Date() },
  });

  await logAdmin({
    adminUserId: session.user.id,
    action: 'delete_library_doc',
    targetType: 'library_doc',
    targetId: doc.id,
    details: { slug: doc.slug, title: doc.title },
  });

  return NextResponse.json({ ok: true });
}
