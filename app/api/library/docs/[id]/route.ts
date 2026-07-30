import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { logAdmin } from '@/lib/audit';
import { cleanCategories, isDocType } from '@/lib/library/types';

export const dynamic = 'force-dynamic';

// GET /api/library/docs/[id] (public) — minimal status poll for ProcessingPanel
// and AiDigest (extraction + AI indexing progress).
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const doc = await prisma.libraryDoc.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      slug: true,
      status: true,
      processingError: true,
      aiIndexState: true,
      chapterCount: true,
      deletedAt: true,
    },
  });
  if (!doc || doc.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({
    id: doc.id,
    slug: doc.slug,
    status: doc.status,
    processingError: doc.processingError,
    aiIndexState: doc.aiIndexState,
    chapterCount: doc.chapterCount,
  });
}

const patchSchema = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(300).optional(),
  author: z.string().trim().max(200).optional(),
  summary: z.string().trim().max(1000).optional(),
  abstractMd: z.string().trim().max(20_000).optional(),
  docType: z.enum(['book', 'paper', 'blog', 'article', 'report', 'other']).optional(),
  categories: z.array(z.string()).max(8).optional(),
  visibility: z.enum(['public', 'restricted', 'private']).optional(),
});

// PATCH /api/library/docs/[id] (uploader/admin) — publish-info edit: metadata,
// 类型/分类 and 可见性. Any title/author/summary edit pins them against
// re-extraction; docType/categories edits pin against AI backfill.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const doc = await prisma.libraryDoc.findUnique({
    where: { id: params.id },
    select: { id: true, uploaderId: true, deletedAt: true },
  });
  if (!doc || doc.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const isUploader = doc.uploaderId === session.user.id;
  if (!isUploader && !session.user.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: 'invalid_input', reason: first?.message ?? '请求参数无效' },
      { status: 400 },
    );
  }
  const { title, author, summary, abstractMd, docType, categories, visibility } = parsed.data;
  if (
    title === undefined &&
    author === undefined &&
    summary === undefined &&
    abstractMd === undefined &&
    docType === undefined &&
    categories === undefined &&
    visibility === undefined
  ) {
    return NextResponse.json({ error: 'invalid_input', reason: '没有需要修改的内容' }, { status: 400 });
  }

  const metaTouched = title !== undefined || author !== undefined || summary !== undefined;
  const updated = await prisma.libraryDoc.update({
    where: { id: doc.id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(author !== undefined ? { author: author || null } : {}),
      ...(summary !== undefined ? { summary } : {}),
      ...(abstractMd !== undefined ? { abstractMd } : {}),
      ...(metaTouched ? { metaPinned: true } : {}),
      ...(docType !== undefined && isDocType(docType) ? { docType, docTypePinned: true } : {}),
      ...(categories !== undefined
        ? { categories: cleanCategories(categories), categoriesPinned: true }
        : {}),
      ...(visibility !== undefined ? { visibility } : {}),
    },
    select: {
      id: true,
      slug: true,
      title: true,
      author: true,
      summary: true,
      docType: true,
      categories: true,
      visibility: true,
    },
  });

  if (!isUploader) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'update_library_doc',
      targetType: 'library_doc',
      targetId: doc.id,
      details: parsed.data,
    });
  }
  return NextResponse.json({ ok: true, doc: updated });
}

// DELETE /api/library/docs/[id] (uploader/admin) — soft delete.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const doc = await prisma.libraryDoc.findUnique({
    where: { id: params.id },
    select: { id: true, uploaderId: true, deletedAt: true },
  });
  if (!doc || doc.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const isUploader = doc.uploaderId === session.user.id;
  if (!isUploader && !session.user.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  await prisma.libraryDoc.update({ where: { id: doc.id }, data: { deletedAt: new Date() } });
  if (!isUploader) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'delete_library_doc',
      targetType: 'library_doc',
      targetId: doc.id,
    });
  }
  return NextResponse.json({ ok: true });
}
